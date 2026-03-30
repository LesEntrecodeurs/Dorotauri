# Spec : Onglet "Modifications" dans la vue Projet

## Contexte

La vue projet de Dorothy affiche actuellement uniquement la documentation (fichiers markdown) dans un panneau avec arbre de fichiers + viewer. On souhaite ajouter un second onglet "Modifications" qui affiche l'ensemble des fichiers modifies (via `git diff`) dans un arbre similaire, avec les conventions de couleurs git, et un viewer de diff style GitHub (numeros de ligne, lignes +/-, couleurs).

## Decisions de design

- **Source du diff** : Deux modes — "Working tree" (`git diff HEAD` = staged + unstaged vs HEAD) et "Dernier commit" (`git diff HEAD~1 HEAD`). Defaut : working tree. Selecteur dans la sidebar.
- **Vue du diff** : Unified (pas split). Plus simple, s'adapte mieux au layout sidebar+content, coherent avec GitHub par defaut.
- **Parsing du diff** : Cote Rust (backend). Le Tauri command retourne des donnees structurees, pas du texte brut.
- **Syntax highlighting** : V1 sans syntax highlighting dans le diff (couleurs de diff suffisantes). Peut etre ajoute en v2.

## Fichiers a modifier/creer

| Fichier | Action | Description |
|---------|--------|-------------|
| `src-tauri/src/commands/shell.rs` | Modifier | +4 structs, +2 commandes Tauri pour git diff |
| `src-tauri/src/lib.rs` (ligne ~202) | Modifier | Enregistrer les 2 nouvelles commandes |
| `src/components/ProjectDocs/useDiffData.ts` | Creer | Hook custom pour fetch/gestion de l'etat diff |
| `src/components/ProjectDocs/DiffFileTree.tsx` | Creer | Arbre de fichiers modifies avec couleurs git |
| `src/components/ProjectDocs/DiffViewer.tsx` | Creer | Renderer de diff unifie style GitHub |
| `src/components/ProjectDocs/ProjectDocsPanel.tsx` | Modifier | Wrapper Tabs, integrer l'onglet Modifications |

## Etape 1 : Backend Rust — Commandes Tauri

### Fichier : `src-tauri/src/commands/shell.rs`

**Nouveaux structs :**

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,           // chemin relatif
    pub status: String,         // "added" | "modified" | "deleted" | "renamed"
    pub old_path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunkLine {
    pub line_type: String,      // "add" | "remove" | "context"
    pub content: String,        // contenu sans prefixe +/-
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,         // la ligne @@ ... @@
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffHunkLine>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: u32,
    pub deletions: u32,
}
```

**Commande `project_git_changed_files`** :

```rust
#[tauri::command]
pub fn project_git_changed_files(project_path: String, mode: String) -> Result<Vec<GitChangedFile>, String>
```

- `mode == "working"` -> `git diff --name-status HEAD`
- `mode == "last_commit"` -> `git diff --name-status HEAD~1 HEAD`
- Parse la sortie tab-separee : `M\tsrc/foo.rs`, `A\tnew.ts`, `D\told.txt`, `R100\told\tnew`
- Mapping : A=added, M=modified, D=deleted, R=renamed

**Commande `project_git_diff_file`** :

```rust
#[tauri::command]
pub fn project_git_diff_file(project_path: String, file_path: String, mode: String) -> Result<FileDiff, String>
```

- `mode == "working"` -> `git diff HEAD -- <file_path>`
- `mode == "last_commit"` -> `git diff HEAD~1 HEAD -- <file_path>`
- Parse le diff unifie :
  - Detecter `Binary files differ`
  - Parser `@@ -old_start,count +new_start,count @@`
  - Classifier les lignes : `+` = add, `-` = remove, ` ` = context
  - Tracker les numeros de ligne (old_line pour context/remove, new_line pour context/add)
- Securite : valider que `file_path` est relatif et ne contient pas `..`
- Limiter a 10 000 lignes par fichier

### Fichier : `src-tauri/src/lib.rs` (ligne ~202)

Ajouter apres `project_search_docs` :

```rust
commands::shell::project_git_changed_files,
commands::shell::project_git_diff_file,
```

## Etape 2 : Hook React — useDiffData

### Nouveau fichier : `src/components/ProjectDocs/useDiffData.ts`

Types TypeScript miroir des structs Rust :

```typescript
export interface GitChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export interface DiffHunkLine {
  lineType: 'add' | 'remove' | 'context';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  path: string;
  status: string;
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export type DiffMode = 'working' | 'last_commit';
```

Le hook expose :

- `changedFiles`, `selectedFile`, `fileDiff`, `diffMode`
- `setDiffMode()`, `selectFile()`, `refresh()`
- `loading`, `loadingDiff`

Utilise `invoke` de `@tauri-apps/api/core`. Fetch automatique quand `projectPath` ou `diffMode` change. Fetch du diff fichier quand `selectedFile` change.

## Etape 3 : Arbre de fichiers modifies — DiffFileTree

### Nouveau fichier : `src/components/ProjectDocs/DiffFileTree.tsx`

Meme pattern que `DocFileTree.tsx` (fonction `buildTree`, composant recursif `TreeItem`) avec :

- **Couleurs par statut** :
  - `added` -> `text-green-500`, icone `FilePlus` (lucide)
  - `modified` -> `text-amber-500`, icone `FileText`
  - `deleted` -> `text-red-500` + `line-through` sur le nom, icone `FileMinus`
  - `renamed` -> `text-blue-500`, icone `FileSymlink`

- **Badge de statut** : lettre coloree (`A`, `M`, `D`, `R`) a droite du nom de fichier

- Props : `files: GitChangedFile[]`, `selectedPath: string | null`, `onSelect: (path: string) => void`

- L'arbre est construit en splittant `path` par `/` pour creer la hierarchie de dossiers (meme algo que `buildTree` dans `DocFileTree.tsx`).

## Etape 4 : Viewer de diff — DiffViewer

### Nouveau fichier : `src/components/ProjectDocs/DiffViewer.tsx`

Props : `diff: FileDiff`, `fileName: string`

**Layout :**

1. Barre superieure : nom du fichier + badge statut + stats (`+N -M` en vert/rouge)
2. Si `isBinary` : message "Fichier binaire modifie"
3. Pour chaque hunk :
   - **Header de hunk** : ligne `@@ ... @@` sur fond `bg-primary/10 text-primary/70`
   - **Lignes du diff** en tableau monospace :

```
| old_line | new_line | +/- | contenu                    |
|----------|----------|-----|----------------------------|
|      747 |          |  -  | // Capture session for...  |  <- bg-red-500/10
|          |      747 |  +  | // Capture session for...  |  <- bg-green-500/10
|      750 |      751 |     | let knowledge = state...   |  <- pas de fond
```

**Styles des lignes :**

- Ajout : `bg-green-500/10`, prefixe `+` en `text-green-400`
- Suppression : `bg-red-500/10`, prefixe `-` en `text-red-400`
- Contexte : pas de fond, texte standard
- Numeros de ligne : `text-muted-foreground/40`, `tabular-nums`, `select-none`
- Font : `font-mono text-xs` (coherent avec CodePanel)

**Cas limites :**

- Fichier binaire -> placeholder "Binary file changed"
- Diff trop long -> notice "Diff tronque"
- Fichier supprime -> toutes les lignes en rouge
- Fichier ajoute -> toutes les lignes en vert

## Etape 5 : Integration des onglets dans ProjectDocsPanel

### Fichier : `src/components/ProjectDocs/ProjectDocsPanel.tsx`

**Imports a ajouter :**

```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DiffFileTree } from './DiffFileTree';
import { DiffViewer } from './DiffViewer';
import { useDiffData } from './useDiffData';
import { GitBranch } from 'lucide-react';
```

**Structure modifiee :**

```
<div className="flex flex-col h-full">
  <Header> (existant, inchange)
  <Tabs defaultValue="docs" className="flex flex-col flex-1 min-h-0">
    <div className="border-b border-border px-4 shrink-0">
      <TabsList className="h-auto bg-transparent p-0 gap-0">
        <TabsTrigger value="docs" className="... border-b-2 style tabs">
          Documentation
        </TabsTrigger>
        <TabsTrigger value="modifications" className="...">
          <GitBranch className="w-3 h-3 mr-1.5" />
          Modifications {changedFiles.length > 0 && <badge>}
        </TabsTrigger>
      </TabsList>
    </div>

    <TabsContent value="docs" className="flex flex-1 min-h-0 mt-0">
      // === contenu existant inchange ===
      <Sidebar DocFileTree>
      <ResizeHandle>
      <Content SimpleMarkdown>
    </TabsContent>

    <TabsContent value="modifications" className="flex flex-1 min-h-0 mt-0">
      <DiffSidebar>
        <ModeSelector "Working" / "Last commit">
        <DiffFileTree />
        <Summary "X fichiers modifies">
      </DiffSidebar>
      <ResizeHandle>
      <DiffViewer />
    </TabsContent>
  </Tabs>
</div>
```

**Style des onglets** (underline, pas pill) :

```
TabsTrigger: "px-3 py-1.5 text-xs rounded-none border-b-2 border-transparent
             data-[state=active]:border-primary data-[state=active]:text-foreground
             text-muted-foreground hover:text-foreground transition-colors"
```

**Lazy loading** : appeler `useDiffData` avec un flag pour ne fetch que quand l'onglet Modifications est actif (via `onValueChange` du Tabs).

**Le mode selector** dans la sidebar Modifications : deux boutons segmentes "Working" / "Dernier commit" styles comme des petits toggles.

## Ordre d'implementation

1. `shell.rs` + `lib.rs` — backend (pas de dependance frontend)
2. `useDiffData.ts` — hook (depend du backend)
3. `DiffFileTree.tsx` — composant standalone
4. `DiffViewer.tsx` — composant standalone
5. `ProjectDocsPanel.tsx` — integration finale

Les etapes 3 et 4 sont parallelisables.

## Verification

1. `cargo build` dans `src-tauri/` -> compilation backend OK
2. `pnpm dev` -> app demarre sans erreur
3. Ouvrir un projet git -> onglet "Documentation" fonctionne comme avant
4. Cliquer sur "Modifications" -> arbre des fichiers modifies apparait avec couleurs
5. Cliquer sur un fichier -> diff affiche style GitHub avec numeros de ligne et couleurs
6. Tester le switch "Working" / "Dernier commit"
7. Tester edge cases : pas de modifications, fichier binaire, nouveau fichier (tout vert), fichier supprime (tout rouge)
