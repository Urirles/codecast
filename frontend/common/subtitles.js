
import React from 'react';
import ReactDOM from 'react-dom';
import {Alert} from 'react-bootstrap';
import classnames from 'classnames';
import srtParse from 'subtitle/lib/parse';  //  {parse, stringify, resync, toMS, toSrtTime}
import clickDrag from 'react-clickdrag';
import Portal from 'react-portal';
import scrollIntoViewIfNeeded from 'scroll-into-view-if-needed';
import {takeLatest, put, call} from 'redux-saga/effects';
import request from 'superagent';
import Immutable from 'immutable';

import {Button} from '../ui';
import {formatTime} from './utils';

function readFileAsText (file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (event) { resolve(event.target.result); };
    reader.onerror = function (event) { reject(event.target.error); };
    reader.readAsText(file, 'utf-8');
  });
}

class SubtitlesMenu extends React.PureComponent {
  render() {
    const {getMessage, Popup} = this.props;
    const menuButton = (
      <Button title={getMessage("CLOSED_CAPTIONS").s}>
        <i className='fa fa-cc'/>
      </Button>
    );
    return (
      <Portal closeOnEsc closeOnOutsideClick openByClickOn={menuButton}>
        <Popup/>
      </Portal>
    );
  }
}

class SubtitlesPopup extends React.PureComponent {
  render () {
    const {availableSubtitles, loadedKey, busy, lastError, paneEnabled} = this.props;
    return (
      <div className='menu-popup' onClick={this._close}>
        <div className='menu-popup-inset' onClick={this._stopPropagation}>
          <div className='pull-right'>
            {busy && <i className='fa fa-spinner fa-spin'/>}
            <Button onClick={this._close}>
              <i className='fa fa-times'/>
            </Button>
          </div>
          <ul>
            <Button onClick={this._clearSubtitles} active={!loadedKey}>{"off"}</Button>
            {availableSubtitles.map(option =>
              <SubtitlesOption key={option.key} option={option} loaded={option.key === loadedKey} onSelect={this._selectSubtitles} />)}
          </ul>
          {lastError && <Alert bsStyle='danger'>{lastError}</Alert>}
          <p onClick={this._changePaneEnabled}>
            {"checkbox "}{paneEnabled ? 't' : 'f'}{" show pane"}
          </p>
        </div>
      </div>
    );
  }
  _stopPropagation = (event) => {
    event.stopPropagation();
  };
  _close = (event) => {
    event.stopPropagation();
    this.props.closePortal();
  };
  _clearSubtitles = () => {
    this.props.dispatch({type: this.props.subtitlesCleared});
  };
  _selectSubtitles = ({key, url}) => {
    this.props.dispatch({type: this.props.subtitlesLoadFromUrl, payload: {key, url}});
  };
  _changePaneEnabled = () => {
    this.props.dispatch({
      type: this.props.subtitlesPaneEnabledChanged,
      payload: {value: !this.props.paneEnabled}});
  }
}

class SubtitlesOption extends React.PureComponent {
  render () {
    const {option, loaded} = this.props;
    return <Button onClick={this._clicked} active={loaded}>{option.key}</Button>;
  }
  _clicked = () => {
    this.props.onSelect(this.props.option);
  };
}

class SubtitleItem extends React.PureComponent {
  render() {
    const {item: {text, start}, selected} = this.props;
    return (
      <p className={classnames(['subtitles-item', selected && 'subtitles-item-selected'])} onClick={this._onClick}>
        <span className='subtitles-timestamp'>{formatTime(start)}</span>
        <span className='subtitles-text'>{text}</span>
      </p>
    );
  }
  _onClick = () => {
    this.props.onClick(this.props.item);
  };
}

class SubtitlesPane extends React.PureComponent {
  render () {
    const {subtitles, currentIndex} = this.props;
    return (
      <div className='subtitles-pane'>
        {subtitles && subtitles.length > 0
          ? subtitles.map((st, index) => {
              const selected = currentIndex === index;
              const ref = selected && this._refSelected;
              return <SubtitleItem key={index} item={st} selected={selected} ref={ref} onClick={this._onSubtitleClick}/>;
            })
          : <p>{"No subtitles"}</p>}
      </div>
    );
  }
  componentDidUpdate (prevProps) {
    if (this.props.currentIndex !== prevProps.currentIndex) {
      if (this._selectedComponent) {
        const domNode = ReactDOM.findDOMNode(this._selectedComponent);
        scrollIntoViewIfNeeded(domNode, {centerIfNeeded: true, easing: 'ease', duration: 300});
      }
    }
  }
  _refSelected = (component) => {
    this._selectedComponent = component;
  };
  _onSubtitleClick = (subtitle) => {
    this.props.dispatch({type: this.props.playerSeek, audioTime: subtitle.start});
  };
}

class SubtitlesBand extends React.PureComponent {
  render () {
    const {active, item, offsetY, dataDrag: {isMoving}} = this.props;
    const translation = `translate(0px, ${this.state.currentY}px)`;
    return (
      <div className={classnames(['subtitles-band', `subtitles-band-${active?'':'in'}active`, isMoving && 'subtitles-band-moving', 'no-select'])}
        style={{transform: translation}}>
        <div className='subtitles-band-frame'>
          {item && <p className='subtitles-text'>{item.text}</p>}
        </div>
      </div>
    );
  }
  componentWillReceiveProps (nextProps) {
    if (nextProps.dataDrag.isMoving) {
      this.setState({
        currentY: this.state.lastPositionY + nextProps.dataDrag.moveDeltaY
      });
    } else {
      this.setState({
        lastPositionY: this.state.currentY
      });
    }
  }
  state = {currentY: 0, lastPositionY: 0};
}

function initReducer (state) {
  return state.set('subtitles', {}).update('panes', panes => panes.set('subtitles',
    Immutable.Map({
      View: state.get('scope').SubtitlesPane,
      enabled: false,
      width: 200
    })));
}

function subtitlesModeSetReducer (state, {payload: {mode}}) {
  state = state.update('subtitles', subtitles => ({...subtitles, mode}));
  if (mode === 'editor') {
    /* The subtitles pane is always enabled in the editor. */
    state = state.setIn(['panes', 'subtitles', 'enabled'], true);
  }
  /* TODO: if mode is 'player', reload state from local storage settings? */
  return state;
}

function subtitlesPaneEnabledChangedReducer (state, {payload: {value}}) {
  return state.setIn(['panes', 'subtitles', 'enabled'], value);
}

function playerReadyReducer (state, {baseDataUrl, data}) {
  const availableSubtitles = (data.subtitles||[]).map(function (key) {
    const url = `${baseDataUrl}-${key}.srt`;
    return {key, url};
  });
  return state.update('subtitles', subtitles => (
    {...subtitles,
      availableSubtitles,
      items: [],
      currentIndex: 0,
      loadedKey: false
    }));
}

function subtitlesClearedReducer (state, _action) {
  return state.update('subtitles', subtitles => (
    {...subtitles, text: '', items: [], currentIndex: 0, loadedKey: false}))
    .set('showSubtitlesBand', false);
}

function subtitlesLoadStartedReducer (state, {payload: {key}}) {
  return state.update('subtitles', subtitles => (
    {...subtitles, loading: key, lastError: false}));
}

function subtitlesLoadSucceededReducer (state, {payload: {key, text, items}}) {
  return state
    .update('subtitles', subtitles => (
      updateCurrentItem({...subtitles, loadedKey: key, loading: false, text, items})))
    .set('showSubtitlesBand', true);
}

function subtitlesLoadedSelector (state) {
  return state.get('subtitles').loadedKey;
}

function subtitlesAvailableSelector (state) {
  return state.get('subtitles').availableSubtitles;
}

function subtitlesLoadFailedReducer (state, {payload: {error}}) {
  console.log('subtitles failed to load', error);
  let errorText = state.get('getMessage')("SUBTITLES_FAILED_TO_LOAD").s;
  if (error.res) {
    errorText = `${errorText} (${error.res.statusText})`;
  }
  return state.update('subtitles', subtitles => (
    {...subtitles, loading: false, lastError: errorText, text: errorText}))
    .set('showSubtitlesBand', false);
}

function playerSeekedReducer (state, action) {
  const {seekTo} = action;
  return state.update('subtitles', function (subtitles) {
    return updateCurrentItem(subtitles, seekTo);
  });
}

function playerTickReducer (state, action) {
  const {audioTime} = action;
  return state.update('subtitles', function (subtitles) {
    return updateCurrentItem(subtitles, audioTime);
  });
}

function subtitlesBandBeginMoveReducer (state, {payload: {y}}) {
  return state.update('subtitles', function (subtitles) {
    return {...subtitles, isMoving: true, startY: y};
  });
}

function subtitlesBandEndMoveReducer (state, _action) {
  return state.update('subtitles', function (subtitles) {
    return {...subtitles, isMoving: false};
  });
}

function subtitlesBandMovedReducer (state, {payload: {y}}) {
  return state.update('subtitles', function (subtitles) {
    return {...subtitles, offsetY: 10 - (y - subtitles.startY)};
  });
}

function findSubtitleIndex (items, time) {
  let low = 0, high = items.length;
  while (low + 1 < high) {
    const mid = (low + high) / 2 | 0;
    const item = items[mid];
    if (item.start <= time) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

function updateCurrentItem (subtitles, audioTime) {
  if (!subtitles.items) return subtitles;
  if (!audioTime) { audioTime = subtitles.audioTime; }
  const currentIndex = findSubtitleIndex(subtitles.items, audioTime);
  const currentItem = subtitles.items[currentIndex];
  const itemVisible = currentItem && currentItem.start <= audioTime && audioTime <= currentItem.end;
  return {...subtitles, audioTime, currentIndex, itemVisible};
}

function getSubtitles (url) {
  return new Promise(function (resolve, reject) {
    var req = request.get(url);
    req.set('Accept', 'text/plain'); // XXX mime-type for srt?
    req.end(function (err, res) {
      if (err) return reject({err, res});
      resolve(res.text);
    });
  });
}

function subtitlesGetMenu (state) {
  const subtitles = state.get('subtitles');
  if (subtitles.mode === 'editor') return false;
  const playerData = state.getIn(['player', 'data']);
  if (!playerData) return false;
  return playerData.subtitles ? state.get('scope').SubtitlesMenu : false;
}

module.exports = function (bundle, deps) {

  bundle.use('getPlayerState', 'playerSeek');
  bundle.addReducer('init', initReducer);

  bundle.defineAction('subtitlesModeSet', 'Subtitles.Mode.Set');
  bundle.addReducer('subtitlesModeSet', subtitlesModeSetReducer);

  bundle.defineView('SubtitlesPane', SubtitlesPaneSelector, SubtitlesPane);
  bundle.defineAction('subtitlesPaneEnabledChanged', 'Subtitles.Pane.EnabledChanged');
  bundle.addReducer('subtitlesPaneEnabledChanged', subtitlesPaneEnabledChangedReducer);

  bundle.defineValue('subtitlesGetMenu', subtitlesGetMenu);
  bundle.defineView('SubtitlesMenu', SubtitlesMenuSelector, SubtitlesMenu);
  bundle.defineView('SubtitlesPopup', SubtitlesPopupSelector, SubtitlesPopup);

  bundle.defineAction('subtitlesCleared', 'Subtitles.Cleared');
  bundle.addReducer('subtitlesCleared', subtitlesClearedReducer);
  bundle.addReducer('subtitlesLoadStarted', subtitlesLoadStartedReducer);
  bundle.defineAction('subtitlesLoadStarted', 'Subtitles.LoadStarted');
  bundle.addReducer('subtitlesLoadSucceeded', subtitlesLoadSucceededReducer);
  bundle.defineAction('subtitlesLoadSucceeded', 'Subtitles.LoadSucceeded');
  bundle.defineAction('subtitlesLoadFailed', 'Subtitles.LoadFailed');
  bundle.addReducer('subtitlesLoadFailed', subtitlesLoadFailedReducer);
  bundle.defineAction('subtitlesLoadFromUrl', 'Subtitles.Selected');
  bundle.addSaga(subtitlesSaga);
  bundle.defineSelector('subtitlesLoadedSelector', subtitlesLoadedSelector);
  bundle.defineSelector('subtitlesAvailableSelector', subtitlesAvailableSelector);
  bundle.defineAction('subtitlesLoadFromFile', 'Subtitles.LoadFromFile');

  bundle.defineView('SubtitlesBand', SubtitlesBandSelector,
    clickDrag(SubtitlesBand, {touch: true}));
  bundle.defineAction('subtitlesBandBeginMove', 'Subtitles.Band.BeginMove');
  bundle.addReducer('subtitlesBandBeginMove', subtitlesBandBeginMoveReducer);
  bundle.defineAction('subtitlesBandEndMove', 'Subtitles.Band.EndMove');
  bundle.addReducer('subtitlesBandEndMove', subtitlesBandEndMoveReducer);
  bundle.defineAction('subtitlesBandMoved', 'Subtitles.Band.Moved');
  bundle.addReducer('subtitlesBandMoved', subtitlesBandMovedReducer);

  bundle.addReducer('playerSeeked', playerSeekedReducer);
  bundle.addReducer('playerTick', playerTickReducer);
  bundle.addReducer('playerReady', playerReadyReducer);

  function SubtitlesMenuSelector (state, props) {
    const getMessage = state.get('getMessage');
    return {getMessage, Popup: deps.SubtitlesPopup};
  }

  function SubtitlesPopupSelector (state, props) {
    const {loadedKey, loading, lastError, availableSubtitles} = state.get('subtitles');
    const paneEnabled = state.getIn(['panes', 'subtitles', 'enabled']);
    const {subtitlesCleared, subtitlesLoadFromUrl, subtitlesPaneEnabledChanged} = deps;
    return {
      availableSubtitles, loadedKey, busy: !!loading, lastError,
      subtitlesCleared, subtitlesLoadFromUrl,
      paneEnabled, subtitlesPaneEnabledChanged,
    };
  }

  function SubtitlesPaneSelector (state, props) {
    const {playerSeek} = deps;
    const {items, currentIndex} = state.get('subtitles');
    return {subtitles: items, currentIndex, playerSeek};
  }

  function SubtitlesBandSelector (state, props) {
    const {items, currentIndex, itemVisible, isMoving, offsetY} = state.get('subtitles');
    if (!items) return {};
    return {
      active: itemVisible, item: items[currentIndex], isMoving, offsetY,
      beginMove: deps.subtitlesBandBeginMove,
      endMove: deps.subtitlesBandEndMove,
      doMove: deps.subtitlesBandMoved,
    };
  }

  function* subtitlesSaga () {
    yield takeLatest(deps.subtitlesLoadFromUrl, subtitlesLoadFromUrlSaga);
    yield takeLatest(deps.subtitlesLoadFromFile, subtitlesLoadFromFileSaga);
  }

  function* subtitlesLoadFromUrlSaga ({payload: {key, url}}) {
    yield put({type: deps.subtitlesLoadStarted, payload: {key}});
    try {
      const text = yield call(getSubtitles, url);
      const items = srtParse(text);
      yield put({type: deps.subtitlesLoadSucceeded, payload: {key, text, items}});
    } catch (ex) {
      yield put({type: deps.subtitlesLoadFailed, payload: {error: ex}});
    }
  }

  function* subtitlesLoadFromFileSaga ({payload: {key, file}}) {
    try {
      console.log('subtitlesLoadFromFileSaga', file);
      const text = yield call(readFileAsText, file);
      const items = srtParse(text);
      yield put({type: deps.subtitlesLoadSucceeded, payload: {key, text, items}});
    } catch (ex) {
      yield put({type: deps.subtitlesLoadFailed, payload: {error: ex}});
    }
  }

};
