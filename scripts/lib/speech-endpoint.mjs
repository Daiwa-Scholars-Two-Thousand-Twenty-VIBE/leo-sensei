const loopbackSpeechUrl = (value) => URL.parse(String(value ?? "").trim());

export const normalizeExternalSpeechEndpoint = (value) => ((url) => (
  url?.protocol === "http:"
  && url.hostname === "127.0.0.1"
  && url.port !== ""
  && url.username === ""
  && url.password === ""
  && url.search === ""
  && url.hash === ""
    ? url.href
    : null
))(loopbackSpeechUrl(value));
