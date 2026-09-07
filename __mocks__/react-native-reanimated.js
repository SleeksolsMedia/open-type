/**
 * Lightweight Jest mock for react-native-reanimated.
 * Renders Animated primitives as plain RN views and turns worklet
 * helpers into identity functions so logic tests stay synchronous.
 */
const React = require('react');
const {ScrollView, Text, View} = require('react-native');

const chainable = () => {
  const t = {};
  t.duration = () => t;
  t.delay = () => t;
  t.springify = () => t;
  t.damping = () => t;
  t.stiffness = () => t;
  t.withCallback = () => t;
  return t;
};

const Animated = {
  View,
  Text,
  ScrollView,
};

const api = {
  __esModule: true,
  default: null, // set below
  ...Animated,
  FadeIn: chainable(),
  FadeInUp: chainable(),
  FadeOut: chainable(),
  Layout: {springify: () => ({})},
  useSharedValue: init => ({value: init}),
  useAnimatedStyle: fn => (typeof fn === 'function' ? fn() : {}),
  useAnimatedProps: () => ({}),
  useDerivedValue: fn => ({value: typeof fn === 'function' ? fn() : undefined}),
  withTiming: v => v,
  withSpring: v => v,
  withRepeat: v => v,
  withSequence: (...args) => args[0],
  withDelay: (_d, v) => v,
  cancelAnimation: () => {},
  createAnimatedComponent: C => C,
  runOnJS: fn => fn,
  runOnUI: fn => fn,
};
api.default = {...api};

module.exports = api;
