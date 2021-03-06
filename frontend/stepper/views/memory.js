/*

Memory view directive.

# View-model description

The cells property of the view-model contains an array of cell objects.
Each cell has a 'column' property giving its column number (equal to its index
in the cells array).
A cell with a 'gap' property represents a gap in a sequence of
addresses.
A cell with an 'address' property represents a byte-size memory location,
and has these additional properties:
  - current: current byte content;
  - load: rank of latest load operation in memory log, if present;
  - store: rank of latest store operation in memory log, if present;
  - previous: previous byte content, if present.

Document:
- bytes
- variables
- extras
- cursors

*/

import React from 'react';
import EpicComponent from 'epic-component';
import Slider from 'rc-slider';
import {Button, ButtonGroup} from 'react-bootstrap';
import classnames from 'classnames';
import {ViewerResponsive, ViewerHelper} from 'react-svg-pan-zoom';
import range from 'node-range';
import * as C from 'persistent-c';
import adt from 'adt';

import {
  getNumber, getIdent, getList, renderArrow, renderValue, evalExpr,
  highlightColors} from './utils';
import {getCursorMap, finalizeCursors} from './array_utils';
import {enumerateHeapBlocks} from '../heap';

const List = adt.data(function () {
  return {
    Nil: null,
    Cons: {
      head: adt.any,
      tail: adt.only(this)
    }
  };
});

function rotate (a, x, y) {
  const a1 = a * Math.PI / 180;
  const sa = Math.sin(a1);
  const ca = Math.cos(a1);
  return {x: x * ca - y * sa, y: x * sa + y * ca};
}

function formatAddress (address) {
  return (address | 0x10000).toString(16).substring(1).toUpperCase();
}

function formatByte (byte) {
  return (byte | 0x100).toString(16).substring(1).toUpperCase();
}

/* Add to `byteOps` an object describing the latest the memory load/store
   operation in `memoryLog` for the byte at `address`.
   Ideally the representation of the memoryLog would allow a more efficient
   lookup.
 */
function saveByteMemoryOps (byteOps, memoryLog, address) {
  const ops = byteOps[address] = {};
  memoryLog.forEach(function (entry, i) {
    const ref = entry[1];
    const base = ref.address;
    if (base <= address) {
      const limit = ref.address + ref.type.pointee.size - 1;
      if (address <= limit) {
        ops[entry[0]] = i;
      }
    }
  });
  return ops;
}

function getByteRangeOps (byteOps, start, end) {
  let load, store;
  for (let address = start; address <= end; address += 1) {
    const ops = byteOps[address];
    if (ops) {
      load = maxDefinedRank(load, ops.load);
      store = maxDefinedRank(store, ops.store);
    }
  }
  return {load, store};
}

function maxDefinedRank (r1, r2) {
  if (r1 === undefined)
    return r2;
  if (r2 === undefined)
    return r1;
  return Math.max(r1, r2);
}

function viewValue (context, byteOps, ref) {
  const {core, oldCore} = context;
  const {address} = ref;
  const {size} = ref.type.pointee;
  const current = C.readValue(core, ref);
  const cell = {address, size, current};
  const ops = getByteRangeOps(byteOps, address, address + size - 1);
  cell.load = ops.load;
  if (ops.store !== undefined) {
    cell.store = ops.store;
    cell.previous = C.readValue(oldCore, ref);
  }
  return cell;
}

function viewExtraCells (context, byteOps, ref, startAddress, endAddress) {
  const refType = ref.type;
  const {size} = refType.pointee;
  // Align `startAddress` with `ref`.
  const alignment = ref.address % size;
  startAddress -= startAddress % size - alignment;
  const cells = [];
  for (let address = startAddress; address + size - 1 <= endAddress; address += size) {
    const valRef = {...ref, address};
    const cell = viewValue(context, byteOps, valRef);
    cells.push(cell);
  }
  return {size, cells};
}

function formatLabelShort (name, path) {
  if (path.isNil) {
    return name;
  }
  const elem = path.get(0);
  if (typeof elem === 'number') {
    return `[${elem}]`;
  }
  if (typeof elem === 'string') {
    return `.${elem}`;
  }
  return '?';
}

const formatLabel = function (name, path) {
  const elems = [];
  while (!path.isNil) {
    const elem = path.get(0);
    if (typeof elem === 'number') {
      elems.unshift(`[${elem}]`);
    } else if (typeof elem === 'string') {
      elems.unshift(`.${elem}`);
    } else {
      elems.unshift('?');
    }
    path = path.get(1);
  }
  elems.unshift(name);
  return elems.join('');
};

const allValuesInRange = function* (path, refType, address, startAddress, endAddress) {
  const type = refType.pointee;
  const size = type.size;
  if (type.kind === 'builtin' || type.kind === 'pointer') {
    if (startAddress <= address && address + size - 1 <= endAddress) {
      const ref = new C.PointerValue(refType, address);
      yield {ref, path};
    }
  }
  if (type.kind === 'array' && type.count !== undefined) {
    const elemType = type.elem;
    const elemCount = type.count.toInteger();
    const elemTypePtr = C.pointerType(elemType);
    let firstIndex = Math.floor((startAddress - address) / elemType.size);
    let lastIndex = Math.floor((endAddress - address) / elemType.size);
    if (firstIndex < elemCount && lastIndex >= 0) {
      firstIndex = Math.max(firstIndex, 0);
      lastIndex = Math.min(lastIndex, elemCount - 1);
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        yield* allValuesInRange(
          List.Cons(index, path),
          elemTypePtr, address + index * elemType.size,
          startAddress, endAddress);
      }
    }
  }
  if (type.kind === 'record') {
    for (let name of type.fields) {
      const {type: fieldType, offset: fieldOffset} = type.fieldMap[name];
      const fieldAddress = address + fieldOffset;
      if (fieldAddress <= endAddress && fieldAddress + fieldType.size >= startAddress) {
        yield* allValuesInRange(
          List.Cons(name, path),
          C.pointerType(fieldType), fieldAddress,
          startAddress, endAddress);
      }
    }
  }
};

/* Enumerate all markers () */
function* allMarkers (core, localMap, cursorExprs) {
  const {memoryLog, globalMap} = core;
  // XXX The initial heap start is a constant in persistent-c.
  yield {kind: 'start', address: 0x100};
  // Cursors
  for (let expr of cursorExprs) {
    try {
      const value = evalExpr(core, localMap, expr, false);
      if (value.type.kind === 'pointer') {
        yield {kind: 'cursor', address: value.address};
      }
    } catch (ex) {
      // skip
    }
  }
  // Memory log (load, store)
  for (let entry of memoryLog) {
    const kind = entry[0];
    const ref = entry[1];
    yield {kind, address: ref.address};
  }
  // Globals
  for (let name of Object.keys(globalMap)) {
    const value = globalMap[name];
    if ('address' in value) {
      yield {kind: 'global', address: value};
    }
  }
  // Stack: function boundaries
  let scope = core.scope;
  while (scope) {
    if (scope.kind === 'function') {
      yield {kind: scope.kind, address: scope.limit};
    }
    scope = scope.parent;
  }
};

class MemoryView extends React.PureComponent {

  render () {
    const {
      Frame, controls, directive, localMap, context, scale, getMessage,
      extraExprs, cursorExprs, cursorRows, nBytesShown, widthFactor,
      layout, centerAddress, startAddress, maxAddress, viewState,
      bytes, cursorMap, variables, extraRows
    } = this.props;
    return (
      <Frame {...this.props}>
        <div className="memory-controls directive-controls">
          <div className="memory-slider-container" style={{width: `${Math.round(400 * widthFactor)}px`}}>
            <Slider prefixCls="memory-slider" tipFormatter={null} value={centerAddress} min={0} max={maxAddress} onChange={this.onSeek}>
              <div className="memory-slider-background"/>
            </Slider>
          </div>
          <ButtonGroup>
            <Button onClick={this.onShiftLeft} title={getMessage('MEMORY_SHIFT_VIEW_LEFT')}>
              <i className="fa fa-arrow-left"/>
            </Button>
            <Button onClick={this.onShiftRight} title={getMessage('MEMORY_SHIFT_VIEW_RIGHT')}>
              <i className="fa fa-arrow-right"/>
            </Button>
          </ButtonGroup>
        </div>
        <div className='clearfix' style={{padding: '2px'}}>
          <div style={{width: '100%', height: `${layout.bottom * scale}px`}}>
            <ViewerResponsive tool='pan' value={viewState} onChange={this.onViewChange} background='transparent' specialKeys={[]}>
              <svg width={layout.right} height={layout.bottom} version='1.1' xmlns='http://www.w3.org/2000/svg'>
                <g className='memory-view'>
                  <g className='grid'>
                    <BytesGrid layout={layout} bytes={bytes} />
                    <VariablesGrid layout={layout} variables={variables} />
                    {extraRows.map((extraRow, index) => <ExtraRowGrid key={index} index={index} layout={layout} extraRow={extraRow} />)}
                  </g>
                  <ByteAddresses layout={layout} bytes={bytes} />
                  <ByteValues layout={layout} bytes={bytes} />
                  <Cursors layout={layout} cursorRows={cursorRows} cursorMap={cursorMap} />
                  <Variables layout={layout} variables={variables} />
                  <g className='extraRows'>
                    {extraRows.map((extraRow, index) => <ExtraRow key={index} index={index} layout={layout} extraRow={extraRow} />)}
                  </g>
                </g>
              </svg>
            </ViewerResponsive>
          </div>
        </div>
      </Frame>
    );
  }

  onShiftLeft = (event) => {
    const fallThrough = false; // XXX could be an option
    const {directive, frames, context, localMap, cursorExprs, centerAddress, nBytesShown} = this.props;
    const {core} = context;
    // Pretend currentAddress is just past the left of the visible area.
    const currentAddress = centerAddress - nBytesShown / 2;
    let nextAddress;
    let maxAddress = currentAddress;
    for (let marker of allMarkers(core, localMap, cursorExprs)) {
      const {kind, address} = marker;
      if (address < currentAddress && (nextAddress === undefined || address > nextAddress)) {
        nextAddress = address;
      }
      if (address > maxAddress) {
        maxAddress = address;
      }
    }
    if (fallThrough && nextAddress === undefined) {
      nextAddress = maxAddress;
    }
    if (nextAddress !== undefined) {
      nextAddress = clipCenterAddress(this.props, nextAddress);
      this.props.onChange(this.props.directive, {centerAddress: nextAddress});
    }
  };

  onShiftRight = (event) => {
    const fallThrough = false; // XXX could be an option
    const {directive, frames, context, localMap, cursorExprs, nBytesShown, centerAddress} = this.props;
    const {core} = context;
    // Pretend currentAddress is just past the right of the visible area.
    const currentAddress = centerAddress + nBytesShown / 2;
    let nextAddress;
    let minAddress = currentAddress;
    for (let marker of allMarkers(core, localMap, cursorExprs)) {
      const {kind, address} = marker;
      if (currentAddress < address && (nextAddress === undefined || address < nextAddress)) {
        nextAddress = address;
      }
      if (address < minAddress) {
        minAddress = address;
      }
    }
    if (fallThrough && nextAddress === undefined) {
      nextAddress = minAddress;
    }
    if (nextAddress !== undefined) {
      nextAddress = clipCenterAddress(this.props, nextAddress);
      this.props.onChange(this.props.directive, {centerAddress: nextAddress});
    }
  };

  onSeek = (centerAddress) => {
    // Clear nibbles 0 and 1.
    centerAddress = centerAddress ^ (centerAddress & 0xFF);
    // Copy nibble 2 into nibble 1 (0xAB00 → 0xABB0)
    centerAddress |= 0xF0 & (centerAddress >> 4);
    this.props.onChange(this.props.directive, {centerAddress});
  };

  onViewChange = (event) => {
    const {mode, startX, startY, matrix} = event.value;
    const {directive, scale, layout} = this.props;
    const nBytesShown = this.props.nBytesShown;
    const centerAddress = clipCenterAddress(this.props, -matrix.e / (layout.cellWidth * scale) + nBytesShown / 2);
    const update = {mode, startX, startY, centerAddress};
    this.props.onChange(directive, update);
  };

}

function BytesGrid ({layout, bytes}) {
  const gd = GridDrawer(layout, layout.bytesTop);
  for (let i = 0; i < bytes.cells.length; i += 1) {
    const cell = bytes.cells[i];
    const {address} = cell;
    gd.drawCellBorder(address, address + 1);
    gd.fillCellBackground(address, address + 1, cell.classes);
  }
  return <g className='bytes'>{gd.finalize()}</g>;
}

function VariablesGrid ({layout, variables}) {
  const gd = GridDrawer(layout, layout.variablesTop);
  for (let i = 0; i < variables.cells.length; i += 1) {
    const cell = variables.cells[i];
    if (cell.sep) {
      gd.addCellClassName(cell.address, cell.sep);
    } else {
      gd.drawCellBorder(cell.address, cell.address + cell.size);
    }
  }
  return <g className='variables'>{gd.finalize()}</g>;
}

function ExtraRowGrid ({layout, index, extraRow}) {
  const {cells, size} = extraRow;
  const gd = GridDrawer(layout, layout.extraRowsTop + index * (layout.cellHeight + layout.cellMargin));
  for (let cell of cells) {
    gd.drawCellBorder(cell.address, cell.address + size);
  }
  return <g className={`extras-${index}`}>{gd.finalize()}</g>;
}

function GridDrawer ({marginLeft, cellWidth, cellHeight}, y0) {
  let rx;  // right border not drawn
  let finalEndCol;
  const hs = [], vs = [], rs = [];
  const ccs = {};
  const x0 = marginLeft;
  const y1 = y0 + cellHeight;
  return {
    drawCellBorder: function (startCol, endCol) {
      const lx = x0 + startCol * cellWidth;
      rx = x0 + endCol * cellWidth;
      finalEndCol = endCol;
      vs.push({key: `v${startCol}`, x: lx, y1: y0, y2: y1});
      hs.push({key: `ht${startCol}`, x1: lx, x2: rx, y: y0});
      hs.push({key: `hb${startCol}`, x1: lx, x2: rx, y: y1});
    },
    fillCellBackground: function (startCol, endCol, className) {
      const x = x0 + startCol * cellWidth;
      const w = (endCol - startCol) * cellWidth;
      rs.push({key: `r${startCol}`, x, w, className});
    },
    addCellClassName: function (col, className) {
      const key = `v${col}`;
      if (key in ccs) {
        ccs[key] = ccs[key] + ' ' + className;
      } else {
        ccs[key] = className;
      }
    },
    finalize: function () {
      // Add the right border of the last cell.
      if (finalEndCol !== undefined) {
        vs.push({key: `v${finalEndCol}`, x: rx, y1: y0, y2: y1});
      }
      // Render the horizontal and vertical elements.
      const elements = [];
      for (let i = 0; i < rs.length; i += 1) {
        const {key, x, w, className} = rs[i];
        elements.push(<rect key={key} x={x} y={y0} width={w} height={cellHeight} className={className}/>);
      }
      for (let i = 0; i < hs.length; i += 1) {
        const {key, x1, x2, y} = hs[i];
        elements.push(<line key={key} x1={x1} x2={x2} y1={y} y2={y} className='h' />);
      }
      for (let i = 0; i < vs.length; i += 1) {
        const {key, x, y1, y2} = vs[i];
        const className = classnames(['v', ccs[key]]);
        elements.push(<line key={key} x1={x} x2={x} y1={y1} y2={y2} className={className} />);
      }
      return elements;
    }
  };
}

function ByteAddresses ({layout, bytes}) {
  const elements = [];
  const x0 = layout.marginLeft;
  const y0 = layout.labelsTop + layout.addressSize.y;
  const dx1 = layout.cellWidth / 2 - layout.addressSize.x / 2; // address label x offset
  for (let cell of bytes.cells) {
    const {column, address, center} = cell;
    const x1 = x0 + column * layout.cellWidth;
    // Top and bottom horizontal lines.
    if (address !== undefined) {
      elements.push(
        <text key={address} transform={`translate(${x1+dx1},${y0}) rotate(${-layout.addressAngle})`} className={center && 'center'}>
          {formatAddress(address)}
        </text>
      );
    }
  }
  return <g className='labels'>{elements}</g>;
}

function ByteValues ({layout, bytes}) {
  const elements = [];
  for (let cell of bytes.cells) {
    if (cell.gap)
      continue;
    const {column, address} = cell;
    const x0 = layout.marginLeft + column * layout.cellWidth;
    const y0 = layout.bytesTop;
    elements.push(
      <g className={cell.classes} key={`0x${address}`} transform={`translate(${x0},${y0})`} clipPath='url(#cell)'>
        {drawCellContent(cell, 'byte', formatByte, layout)}
      </g>
    );
  }
  return <g className='bytes'>{elements}</g>;
}

function Variables ({layout, variables}) {
  const {cells} = variables;
  const elements = [];
  const x0 = layout.marginLeft;
  const y0 = layout.variablesTop;
  const y1 = layout.cellHeight + layout.cellMargin + layout.textLineHeight - layout.textBaseline;
  for (let cell of cells) {
    if (cell.sep) {
      continue;
    }
    const {address, size, name} = cell;
    const x = x0 + address * layout.cellWidth;
    const x1 = size * layout.cellWidth / 2;
    elements.push(
      <g className='cell' key={`0x${address}`} transform={`translate(${x},${y0})`}>
        {drawCellContent(cell, 'variable', renderValue, layout)}
        <text x={x1} y={y1 + (cell.center ? layout.textLineHeight : 0)}
          className={cell.center ? 'var-name-center' : 'var-name'}>{name}</text>
      </g>
    );
  }
  return <g className='variables'>{elements}</g>;
}

function ExtraRow ({layout, index, extraRow}) {
  const elements = [];
  const {size, cells} = extraRow;
  const x0 = layout.marginLeft;
  const y0 = layout.extraRowsTop + index * layout.cellHeight;
  const width = size * layout.cellWidth;
  for (let cell of cells) {
    const {address} = cell;
    const x = x0 + address * layout.cellWidth;
    elements.push(
      <g className='cell' key={`0x${address}`} transform={`translate(${x},${y0})`}>
        {drawCellContent(cell, 'extra', renderValue, layout)}
      </g>
    );
  }
  return <g className='extraRow'>{elements}</g>;
}

function drawCellContent (cell, className, format, layout) {
  const {current, size, load, store, previous} = cell;
  const width = size * layout.cellWidth;
  const x0 = width / 2;
  const y0 = layout.cellPadding + layout.textLineHeight - layout.textBaseline;
  const y1 = y0 + layout.textLineHeight;
  const h1 = (layout.textLineHeight - layout.textBaseline) / 3;
  const currentClasses = classnames(['current-value', load !== undefined && 'value-load']);
  return (
    <g className={className}>
      {store !== undefined &&
        <g className='previous-value'>
          <text x={x0} y={y0}>
            {format(previous)}
          </text>
          <line x1={2} x2={width - 2} y1={y0 - h1} y2={y0 - h1}/>
        </g>}
      <text x={x0} y={y1} className={currentClasses}>
        {format(current)}
      </text>
    </g>
  );
}

function Cursors ({layout, cursorRows, cursorMap}) {
  const elements = [];
  for (let key of Object.keys(cursorMap)) {
    const {index, row, color, labels} = cursorMap[key];
    const x0 = layout.marginLeft + index * layout.cellWidth;
    const y0 = layout.cursorsTop;
    const arrowHeight = layout.minArrowHeight + (cursorRows - row - 1) * layout.textLineHeight;
    const x1 = layout.cellWidth / 2;
    const y1 = row * layout.textLineHeight + layout.textLineHeight - layout.textBaseline;
    const y2 = cursorRows * layout.textLineHeight + layout.minArrowHeight;
    const fillColor = '#eef';
    elements.push(
      <g key={`c${index}`} transform={`translate(${x0},${y0})`} className='cursor'>
        <text x={x1} y={y1}>{labels.join(",")}</text>
        {renderArrow(layout.cellWidth / 2, y2, 'down', 6, arrowHeight)}
      </g>
    );
  }
  return <g className='cursors'>{elements}</g>;
}

function clipCenterAddress ({nBytesShown, context}, address) {
  //address -= nBytesShown / 2;
  address = Math.max(0, address);
  address = Math.min(context.core.memory.size - 1, address);
  //address += nBytesShown / 2;
  return address;
}

function MemoryViewSelector ({scale, directive, context, controls, frames}) {
  const localMap = frames[0].get('localMap');
  const {byName, byPos} = directive;
  const extraExprs = getList(byName.extras, []);
  const cursorExprs = getList(byName.cursors, []);
  const cursorRows = getNumber(byName.cursorRows, 1);
  const nBytesShown = getNumber(byName.bytes, 32);
  const widthFactor = getNumber(byName.width, 1);
  const maxAddress = context.core.memory.size - 1;
  const layout = {};
  layout.textLineHeight = 18;
  layout.textBaseline = 5;
  layout.cellWidth = 32;
  layout.cellPadding = 4;
  layout.cellHeight = layout.cellPadding * 2 + layout.textLineHeight * 2;
  layout.addressAngle = 60;
  layout.addressSize = rotate(layout.addressAngle, 40, layout.textLineHeight)
  layout.marginLeft = 10;
  layout.marginTop = 10;
  layout.marginBottom = 10;
  layout.cellMargin = 4;
  layout.minArrowHeight = 20;
  layout.cursorsHeight = cursorRows * layout.textLineHeight + layout.minArrowHeight;
  layout.labelsHeight = layout.addressSize.y;
  layout.bytesHeight = layout.cellHeight;
  layout.variablesHeight = layout.cellMargin + layout.cellHeight + layout.textLineHeight * 2;
  layout.extraRowsHeight = (layout.cellHeight + layout.cellMargin) * extraExprs.length;
  layout.cursorsTop = layout.marginTop;
  layout.labelsTop = layout.cursorsTop + layout.cursorsHeight;
  layout.bytesTop = layout.labelsTop + layout.marginTop + layout.labelsHeight;
  layout.variablesTop = layout.bytesTop + layout.bytesHeight;
  layout.extraRowsTop = layout.variablesTop + layout.variablesHeight;
  layout.right = layout.marginLeft + layout.cellWidth * (maxAddress + 1);
  layout.bottom = layout.extraRowsTop + layout.extraRowsHeight - layout.cellMargin + layout.marginBottom;

  let centerAddress = controls.get('centerAddress');
  if (centerAddress === undefined) {
    centerAddress = clipCenterAddress({nBytesShown, context}, getNumber(byName.start, nBytesShown / 2));
  }
  const startAddress = centerAddress - nBytesShown / 2;
  const x = -startAddress * layout.cellWidth * scale;
  const viewState = {
    matrix: {a: scale, b: 0, c: 0, d: scale, e: x, f: 0},
    mode: controls.get('mode', 'idle'),
    startX: controls.get('startX'),
    startY: controls.get('startY'),
  };
  const {bytes, cursorMap, variables, extraRows} = extractView(
    layout,
    context,
    localMap,
    {
      centerAddress: centerAddress | 0, /* Clear fractional part for equality tests. */
      nBytesShown: nBytesShown,
      extraBytes: Math.ceil(centerAddress) - Math.floor(centerAddress),
      maxAddress,
      cursorExprs,
      cursorRows,
      extraExprs
    });
  return {
    scale, directive, context, controls, localMap,
    extraExprs, cursorExprs, cursorRows, nBytesShown, widthFactor,
    centerAddress, startAddress, maxAddress,
    layout, viewState, bytes, cursorMap, variables, extraRows
  };
}

function extractView (layout, context, localMap, options) {
  const {core, oldCore} = context;
  const {memory, memoryLog} = core;
  const oldMemory = oldCore.memory;
  const {nBytesShown, extraBytes, maxAddress, cursorRows} = options;
  const centerAddress = options.centerAddress;
  let startAddress = Math.max(0, centerAddress - nBytesShown / 2);
  if (startAddress + nBytesShown >= maxAddress) {
    startAddress = maxAddress - nBytesShown + 1;
  }
  let endAddress = Math.min(maxAddress, Math.floor(startAddress + nBytesShown + extraBytes - 1));
  const cells = [];
  const byteOps = []; // sparse array of {load,store} objects
  for (let address = startAddress; address <= endAddress; address += 1) {
    const current = memory.get(address);
    const cell = {column: address, address, size: 1, current};
    if (address === centerAddress) {
      cell.center = true;
    }
    const ops = saveByteMemoryOps(byteOps, memoryLog, address);
    cell.load = ops.load;
    if (ops.store !== undefined) {
      cell.store = ops.store;
      cell.previous = oldMemory.get(address);
    }
    cells.push(cell);
  }
  const bytes = {startAddress, endAddress, cells};
  // Build the cursor views.
  const cursorMap = getCursorMap(
    core, localMap, options.cursorExprs, {
      minIndex: startAddress, maxIndex: endAddress,
      address: 0, cellSize: 1
    });
  finalizeCursors(range(startAddress, endAddress + 1), cursorMap, options.cursorRows);
  // Build the variables view.
  const variables = viewVariables(context, byteOps, startAddress, endAddress, options);
  // Build the extra-type views.
  const extraRows = [];
  for (let expr of options.extraExprs) {
    try {
      const ref = evalExpr(core, localMap, expr, true);
      if (ref && /^(builtin|pointer)$/.test(ref.type.pointee.kind)) {
        const row = viewExtraCells(context, byteOps, ref, startAddress, endAddress);
        extraRows.push(row);
      }
    } catch (ex) {
      //console.log('failed to evaluate extra expression', expr, ex);
    }
  }
  // Add heap structure annotations to bytes.
  const heapMap = viewHeapFlags(core, startAddress, endAddress);
  setCellClasses(bytes, cursorMap, heapMap);
  return {bytes, cursorMap, variables, extraRows};
}

function viewVariables (context, byteOps, startAddress, endAddress, options) {
  const cells = [];
  const {memory, globalMap} = context.core;
  let {scope} = context.core;
  // Materialize the stack pointer.
  if (scope) {
    cells.push({sep: 'sp', address: scope.limit});
  }
  // Go up the stack until we find an area that contains startAddress.
  while (scope && scope.limit < startAddress) {
    const {type} = scope;
    if (type && scope.limit + type.size >= startAddress) {
      break;
    }
    scope = scope.parent;
  }
  // View cells until a stack area starts past endAddress.
  while (scope && scope.limit <= endAddress) {
    const {limit, kind} = scope;
    switch (kind) {
      case 'variable': {
        const {name, ref} = scope;
        viewVariable(name, ref);
        break;
      }
      case 'block':
        cells.push({sep: 'block', address: limit});
        break;
      case 'function':
        cells.push({sep: 'function', address: limit});
        break;
    }
    scope = scope.parent;
  }
  Object.keys(globalMap).forEach(function (name) {
    /* Values in globalMap are BuiltinValue and PointerValue, and we only
       care about pointers. */
    const ref = globalMap[name];
    if (ref instanceof C.PointerValue) {
      viewVariable(name, ref);
    }
  });
  return {cells};
  function viewVariable (name, ref) {
    for (let value of allValuesInRange(List.Nil, ref.type, ref.address, startAddress, endAddress)) {
      const cell = viewValue(context, byteOps, value.ref);
      cell.center = value.ref.address <= options.centerAddress && options.centerAddress < value.ref.address + value.ref.type.pointee.size;
      if (cell.center) {
        cell.name = formatLabel(name, value.path);
      } else {
        cell.name = formatLabelShort(name, value.path);
      }
      cells.push(cell);
    }
  }
}

function viewHeapFlags (core, startAddress, endAddress) {
  const heapMap = []; // sparse array
  for (let block of enumerateHeapBlocks(core)) {
    const {start, end} = block;
    if (start <= endAddress && end >= startAddress) {
      // Mark header area bytes
      for (let address = block.ref.address; address < start; address += 1) {
        heapMap[address] = 16;
      }
      // Mark data area bytes
      const viewStart = Math.max(start, startAddress);
      const viewEnd = Math.min(end, endAddress);
      const defaultFlag = block.free ? 3 : 1;
      for (let address = viewStart; address <= viewEnd; address += 1) {
        let flags = defaultFlag;
        if (address === start) {
          flags |= 4;
        }
        if (address === end) {
          flags |= 8;
        }
        heapMap[address] = flags;
      }
    }
  }
  return heapMap;
}

function setCellClasses (bytes, cursorMap, heapMap) {
  for (let cell of bytes.cells) {
    const {address, store, load} = cell;
    const cursor = cursorMap[address];
    const heapFlags = heapMap[address];
    const classes = ['cell'];
    if (store !== undefined) {
      classes.push('cell-store');
    }
    if (load !== undefined) {
      classes.push('cell-load');
    }
    if (cursor) {
      classes.push("cell-cursor");
    }
    if (heapFlags !== undefined) {
      classes.push("cell-heap");
      if (heapFlags & 16) {
        classes.push('cell-heap-header');
      }
      if (heapFlags & 2) {
        classes.push('cell-heap-free');
      }
    }
    cell.classes = classnames(classes);
  }
}

export default {View: MemoryView, selector: MemoryViewSelector};
