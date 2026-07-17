const { contextBridge, ipcRenderer } = require("electron");
const mutationArgumentPrefix = "--leo-sensei-mutation-token=";
const mutationToken = process.argv
  .find((argument) => argument.startsWith(mutationArgumentPrefix))
  ?.slice(mutationArgumentPrefix.length) ?? "";
const mutationHeaders = () => mutationToken
  ? Object.freeze({ "X-Leo-Sensei-Mutation-Token": mutationToken })
  : Object.freeze({});

contextBridge.exposeInMainWorld("desktop", Object.freeze({
  platform: process.platform,
  browserApplications: () => ipcRenderer.invoke("desktop:browser-applications"),
  gateBehavior: () => ipcRenderer.invoke("desktop:gate-behavior"),
  focusApplications: () => ipcRenderer.invoke("desktop:focus-applications"),
  mutationHeaders,
}));
