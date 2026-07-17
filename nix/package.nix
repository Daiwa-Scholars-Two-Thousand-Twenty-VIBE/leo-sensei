{
  lib,
  buildNpmPackage,
  makeWrapper,
  nodejs,
}:

buildNpmPackage {
  pname = "leo-sensei-no-nonsense-nihongo";
  version = "1.0.2";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../flake.nix
      (lib.fileset.maybeMissing ../.github)
      (lib.fileset.maybeMissing ../decks)
      (lib.fileset.maybeMissing ../desktop)
      (lib.fileset.maybeMissing ../forge.config.mjs)
      ../nix/package.nix
      ../public
      (lib.fileset.maybeMissing ../release)
      ../scripts
      ../tests
    ];
  };

  npmDepsHash = "sha256-UZEMRXPfp7oipjC4rfJiSBrJuXvlcXcIQNcXLQVk5Cg=";
  npmInstallFlags = [ "--ignore-scripts" ];
  makeCacheWritable = true;
  nativeBuildInputs = [ makeWrapper ];
  dontNpmBuild = true;

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    export TZ=Asia/Tokyo
    npm test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    app="$out/libexec/leo-sensei"
    mkdir -p "$app" "$out/bin"
    cp -R package.json package-lock.json decks public scripts node_modules "$app/"

    makeWrapper ${nodejs}/bin/node "$out/bin/leo-sensei" \
      --add-flags "$app/scripts/language-learning.mjs"
    makeWrapper ${nodejs}/bin/node "$out/bin/leo-sensei-server" \
      --add-flags "$app/scripts/review-server.mjs"

    runHook postInstall
  '';

  meta = {
    description = "Japanese spaced-repetition CLI and loopback review server";
    license = lib.licenses.gpl3Plus;
    mainProgram = "leo-sensei";
    platforms = lib.platforms.unix;
  };
}
