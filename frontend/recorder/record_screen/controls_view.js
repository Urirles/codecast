
import React from 'react';
import {Button} from 'react-bootstrap';
import EpicComponent from 'epic-component';

export default function (m) {

  m.selector('RecorderControls', function (state, props) {
    const recorder = state.get('recorder');
    const recorderState = recorder.get('state');
    const isRecording = recorderState === 'recording';
    const elapsed = Math.round(recorder.get('elapsed') / 1000) || 0;
    const eventCount = recorder.get('events').count();
    const stepper = m.selectors.getStepperState(state);
    const haveStepper = !!stepper;
    const stepperState = haveStepper && stepper.get('state');
    const isStepping = stepperState !== 'idle';
    const stepperDisplay = haveStepper && stepper.get('display');
    const {control} = stepperDisplay || {};
    const canStep = !!(!isStepping && control && control.node);
    return {isRecording, elapsed, eventCount, haveStepper, isStepping, canStep};
  });

  m.view('RecorderControls', EpicComponent(self => {

    const {actions} = m;

    const onPauseRecording = function () {
      // TODO
    };

    const onStopRecording = function () {
      self.props.dispatch({type: actions.recorderStop});
    };

    const onStepExpr = function () {
      self.props.dispatch({type: actions.stepperStep, mode: 'expr'});
    };

    const onStepInto = function () {
      self.props.dispatch({type: actions.stepperStep, mode: 'into'});
    };

    const onStepOut = function () {
      self.props.dispatch({type: actions.stepperStep, mode: 'out'});
    };

    const onStepOver = function () {
      self.props.dispatch({type: actions.stepperStep, mode: 'over'});
    };

    const onInterrupt = function () {
      self.props.dispatch({type: actions.stepperInterrupt});
    };

    const onRestart = function () {
      self.props.dispatch({type: actions.stepperRestart});
    };

    const onEdit = function () {
      self.props.dispatch({type: actions.stepperExit});
    };

    const onTranslate = function () {
      self.props.dispatch({type: actions.translate});
    };

    self.render = function () {
      const {isRecording, elapsed, eventCount, haveStepper, isStepping, canStep} = self.props;
      console.log('canStep', canStep);
      return (
        <div className="pane pane-controls">
          <p>
            {false && <Button onClick={onPauseRecording} disabled={!isRecording}>
              <i className="fa fa-pause"/>
            </Button>}
            <Button onClick={onStopRecording} disabled={!isRecording}>
              <i className="fa fa-stop"/>
            </Button>
            {haveStepper && <Button onClick={onStepExpr} disabled={!canStep}>step expr</Button>}
            {haveStepper && <Button onClick={onStepInto} disabled={!canStep}>step into</Button>}
            {haveStepper && <Button onClick={onStepOut} disabled={!canStep}>step out</Button>}
            {haveStepper && <Button onClick={onStepOver} disabled={!canStep}>step over</Button>}
            {haveStepper && <Button onClick={onInterrupt} disabled={!isStepping}>interrompre</Button>}
            {haveStepper && <Button onClick={onRestart} disabled={isStepping}>recommencer</Button>}
            {haveStepper && <Button onClick={onEdit}>éditer</Button>}
            {haveStepper || <Button onClick={onTranslate} bsStyle='primary'>compiler</Button>}
            {' '}
            <span><i className="fa fa-clock-o"/> {elapsed}s</span>
            {' '}
            <span><i className="fa fa-bolt"/> {eventCount}</span>
          </p>
        </div>
      );
    };

  }));

};
