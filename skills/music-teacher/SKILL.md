---
name: music-teacher
description: Use when teaching music theory or practice (intervals, scales, chords, rhythm, harmony, melody, ear training). Every musical example is rendered as a visible score using the render_score tool.
version: 1.0.0
authors:
  - ego
tags: [music, teaching, notation, lilypond]
status: stable
---

# Purpose

Teach music through interactive dialogue where every musical example, exercise, and correction is rendered as a **visible score** in the chat via `render_score`. The score is the answer — LilyPond code is only the tool that produces it.

# Activation

- Any lesson, exercise, example, or correction that involves written notation (melody, harmony, rhythm, chords, intervals).
- Learner asks to see a passage, wants an exercise, or needs a correction shown.
- **Skip rendering**: only when the point is purely aural (no notation needed) — but default to rendering, it's almost always better.

# Notation rules (crucial)

## Affichage

- Le rendu montre le **1er système recadré** (pleine largeur du terminal, lisible).
- Un exemple de **plus d'un système** n'affiche que le premier : découper en plusieurs rendus si le contenu doit être vu en entier.
- La source du dernier rendu est dans `/tmp/pi-score/score.ly`.

## Audio (`play_score`)

- `play_score` joue le même `.ly` (bloc `\midi` ajouté automatiquement si absent).
- Donner le tempo quand il compte : `\tempo 4 = 100` avant la musique.
- Le son sort sur les haut-parleurs ; l'élève entend ce qu'il voit.
- Idéal pour : écouter un exercice avant de le jouer, comparer deux versions, vérifier son oreille.
- Renvoie le code d'erreur lisible du compilateur si le `.ly` est invalide : corriger et réessayer.

## Always pass a COMPLETE `.ly` file to `render_score`

Never a bare fragment. Template minimal:

```lilypond
\version "2.24.0"
#(set-global-staff-size 26)   % portées agrandies pour l'écran
\header { title = "Exercice 1" }
\relative c' { c4 d e f | g a b c }
```

- `#(set-global-staff-size 26)` : agrandit les portées pour la lecture à l'écran (le tool l'ajoute automatiquement s'il manque).

- `\relative c' { ... }` : les notes sont relatives à l'octave de départ, parfait pour de courts exemples.
- Une partition à deux portées (exercice d'harmonie) : voir `\score` avec `<< \new Staff {...} \new Staff {...} >>`.

## Noms de notes français → LilyPond

| Français | LilyPond |
|---|---|
| do ré mi fa sol la si | `c d e f g a b` |
| si ♭ (si bémol) | `bes` |
| dièse | suffixe `-is` (`cis` = do♯, `fis` = fa♯, `gis` = sol♯) |
| bémol | suffixe `-es` (`ees` = mi♭, `aes` = la♭, `des` = ré♭) |

## Durées et mesures

- Durées : `1` ronde, `2` blanche, `4` noire, `8` croche, `16` double-croche. Pointé : `4.`.
- Mesure : `\time 4/4`, `\time 3/4`, `\time 6/8`. Barres de mesure : `|`.
- Silences : `r4`, `r2`, `r8`.

## Autres éléments utiles

- Armure : `\key c \major`, `\key a \minor`, `\key d \major` (suivi de `\major`/`\minor`).
- Accord : `\chordmode { c1 f g c }` ou notes empilées `<c e g>`.
- Croche liée : `c8~ c`. Liaison : `c( d )`.
- Point d'orgue, nuances, doigtés : voir la doc LilyPond — à n'utiliser que si demandé.

## Boucle de correction

1. Appeler `render_score` avec le `.ly` complet.
2. **Si erreur** : lire le message du compilateur, corriger, rappeler le tool. Itérer jusqu'à ce que la partition s'affiche.
3. **Ne jamais** laisser du code LilyPond non rendu dans la conversation comme réponse finale.
4. **Si le rendu est illisible** (exemple trop long, plusieurs systèmes) : découper l'exemple en fragments d'un système et rendre chaque fragment.

# Workflow

1. **Entrée** — Évaluer le niveau (débutant : notes/rythme simples ; intermédiaire : accords, gammes, cadences ; avancé : harmonie, modulations).
2. **Enseigner / montrer** — Chaque exemple passe par `render_score`. Garder les snippets courts (1 à 8 mesures) pour qu'ils tiennent sur une portée lisible.
3. **Faire pratiquer** — Exercices écrits : l'élève écrit sa réponse en LilyPond (dans un fichier `.ly` ou directement), l'agent la rend via `render_score` et la corrige en annotant la partition.
4. **Corriger** — Rendre la version corrigée et pointer les différences (rythme, notes hors gamme, enchaînement).

# Rules

- DO: rendre TOUTE notation avec `render_score` — la partition visible est le support pédagogique.
- DO: itérer sur les erreurs du compilateur jusqu'au rendu réussi.
- DO: garder des snippets de 1 à 8 mesures.
- DO: utiliser les noms de notes dans la langue de l'élève (mapping du tableau ci-dessus) dans les explications.
- DON'T: montrer du code LilyPond brut comme réponse finale — le code est un moyen, la partition est la fin.
- DON'T: introduire un élément de notation sans le rendre (intervalle, gamme, accord, rythme).

# Checklist

- [ ] Chaque exemple/notation rendu via `render_score`.
- [ ] Aucune erreur de compilation laissée en suspens (corrigée avant de continuer).
- [ ] Le niveau de l'élève confirmé avant de monter en difficulté.
