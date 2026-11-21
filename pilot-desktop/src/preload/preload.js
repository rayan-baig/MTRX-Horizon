// The only bridge between Pilot's windows and the app. Windows run sandboxed
// with no Node.js; this exposes a small, fixed list of calls. No call returns
// an AI key: windows only ever see a key's last four characters.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const call = (name) => (...args) => ipcRenderer.invoke(`pilot:${name}`, ...args);
const listen = (channel) => (fn) => {
  const handler = (_event, data) => fn(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("pilot", {
  robot: {
    hover: call("robot-hover"),
    dragStart: call("robot-drag-start"),
    drop: call("robot-drop"),
    at: call("robot-at"),
    click: call("robot-click"),
    menu: call("robot-menu"),
    env: call("robot-env"),
    onState: listen("pilot:robot"),
    onDo: listen("pilot:robot-do"),
    onShow: listen("pilot:robot-show"),
  },
  chat: {
    send: call("chat-send"),
    stop: call("chat-stop"),
    clear: call("chat-clear"),
    hide: call("chat-hide"),
    focus: call("chat-focus"),
    onFocus: listen("pilot:focus"),
    answer: call("chat-answer"),
    helpScreen: call("chat-help-screen"),
    openLink: call("open-link"),
    copy: call("copy-text"),
    mediaGet: call("media-get"),
    mediaSave: call("media-save"),
    onState: listen("pilot:state"),
    onView: listen("pilot:view"),
  },
  settings: {
    get: call("settings-get"),
    listModels: call("models-list"),
    saveProfile: call("profile-save"),
    removeProfile: call("profile-remove"),
    activate: call("profile-activate"),
    mediaModels: call("media-models"),
    saveMedia: call("media-key-save"),
    removeMedia: call("media-key-remove"),
    setMemory: call("memory-set"),
    removeMemory: call("memory-remove"),
    removeNote: call("note-remove"),
    copyNote: call("note-copy"),
    setTheme: call("theme-set"),
    setLogin: call("login-set"),
    setEnergy: call("energy-set"),
    welcomeDone: call("welcome-done"),
    onChange: listen("pilot:settings"),
  },
  attach: {
    info: call("attach-info"),
    add: call("attach-add"),
    remove: call("attach-remove"),
    heic: call("attach-heic"),
    uploadStart: call("upload-start"),
    uploadPiece: call("upload-piece"),
    progress: call("attach-progress"),
    show: call("attach-show"),
  },
  screen: {
    status: call("screen-status"),
    setMode: call("screen-mode-set"),
    check: call("screen-check"),
    openSettings: call("screen-open-settings"),
    closeHelp: call("screen-help-close"),
  },
  app: {
    about: call("app-about"),
    quit: call("app-quit"),
    relaunch: call("app-relaunch"),
  },
});
