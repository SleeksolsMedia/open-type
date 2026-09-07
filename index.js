/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Headless dictation for the overlay panel (no UI open).
AppRegistry.registerHeadlessTask('DictationTask', () => {
  const task = require('./src/tasks/dictationTask').default;
  return task;
});
