const escapeMarkup = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

export const voiceCustomizationPrompt = `Read AGENTS.md first. Add an optional Japanese neural voice to this app without changing its scheduler, learner data, application gate, or default no-speech behavior.

Keep the speech service separate from the app and bind it only to 127.0.0.1. The app contract is an HTTP POST to LEARNER_TTS_ENDPOINT with JSON {"input":"Japanese text","response_format":"wav","stream":false}; return WAV audio. Configure LEARNER_TTS_ENDPOINT as an explicit URL such as http://127.0.0.1:43127/v1/audio/speech. Do not add a model, model downloader, Python runtime, voice recording, or generated audio to this repository, Nix package, or installer.

For an Apple Silicon Mac, evaluate MLX Audio with mlx-community/Qwen3-TTS-12Hz-1.7B-Base-6bit. Official sources:
https://github.com/Blaizzy/mlx-audio
https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-6bit

For Windows with a compatible NVIDIA GPU, evaluate the official PyTorch/CUDA Qwen3-TTS implementation with Qwen/Qwen3-TTS-12Hz-1.7B-Base. Official sources:
https://github.com/QwenLM/Qwen3-TTS
https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base

Warn before downloading that model files require multiple gigabytes of disk space. Check the machine's available memory, storage, GPU support, and upstream requirements before choosing a model. The Windows reference path expects a compatible NVIDIA/CUDA setup; do not promise useful CPU performance. Keep downloaded weights in the user's normal model cache outside Git and outside the installer. If the hardware is incompatible or setup fails, leave speech unavailable and keep pronunciation controls hidden.

Use only a voice recording that the user owns or has explicit permission to use for voice cloning and redistribution. Do not use or redistribute JVS audio: its official terms do not permit this app to redistribute it. Never commit a recording, reference transcript, generated sample, learner data, or model cache. Use synthetic fixtures in tests.

Implement the smallest local adapter, add one contract test for the JSON request and WAV response, document the one launch command and LEARNER_TTS_ENDPOINT setting, then show the exact files changed and verification results.`;

export const voiceCustomizationContentMarkup = `
  <main class="voice-main">
    <header class="voice-intro">
      <span>Optional voice</span>
      <h2>Add a voice if you want one</h2>
      <p>The app has no voice by default. You can run a voice model separately and connect it to Leo Sensei.</p>
    </header>
    <section class="voice-requirements" aria-label="Voice setup requirements">
      <div><strong>Mac</strong><span>Apple Silicon; MLX model is about 2.7 GB before runtime caches.</span></div>
      <div><strong>Windows</strong><span>Compatible NVIDIA GPU and CUDA recommended; the official base model is about 4.5 GB.</span></div>
      <div><strong>Privacy</strong><span>Use only recordings you own or have explicit permission to clone. Never redistribute JVS audio.</span></div>
    </section>
    <section class="voice-prompt-panel">
      <div class="pane-heading"><h2>Copy this prompt</h2></div>
      <p>Give it to your AI coding tool in a clean copy of the repository. It will check the computer before choosing the Mac or Windows setup.</p>
      <textarea id="voicePrompt" readonly spellcheck="false" aria-label="AI voice customization prompt">${escapeMarkup(voiceCustomizationPrompt)}</textarea>
      <button id="copyVoicePrompt" class="primary-button" type="button">Copy prompt</button>
    </section>
  </main>`;

export const copyVoiceCustomizationPrompt = ({ clipboard }) => typeof clipboard?.writeText === "function"
  ? Promise.resolve()
      .then(() => clipboard.writeText(voiceCustomizationPrompt))
      .then(() => true)
      .catch(() => false)
  : Promise.resolve(false);
