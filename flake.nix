{
  description = "Dev shell for a music course (LilyPond)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.lilypond
          pkgs.fluidsynth     # lecture MIDI (play_score)
          pkgs.soundfont-fluid
          pkgs.pulseaudio     # paplay (lecture WAV)
          pkgs.alsa-utils     # aplay (repli)
        ];
      };
    };
}
