# File access

yingfang#28 removed the git-worktree surface (`/api/worktrees`, the project/worktree picker and
the new-session context bar) and pi-web's password login (`/api/web-auth`,
`lib/auth-throttle.ts`). Sign-in is the yingfang account (`yf_session`; see `AGENTS.md`).

## Who sees which roots
- An ordinary user's files API roots are only that user's own session directory and gallery
  (`ownFileRoots()`, `lib/yf/file-roots.ts`). They are never the union of every session cwd,
  which would let one user read another's directories. Session ownership is a separate guard
  (`lib/yf/session-access.ts`).
- Operators keep the upstream registrable-root behaviour (`getAllowedFileRoots()`): session cwds,
  their resolved project roots, and roots added with `allowFileRoot()`, which
  `/api/cwd/validate` calls when it makes a location browsable. `/api/default-cwd` only creates
  `~/pi-cwd/YYYYMMDD`.
- `lib/worktree.ts` still resolves a linked worktree's top level to its main repository root, so
  sessions group by project (`lib/session-reader.ts`) and `/api/cwd/validate` treats them alike.
  Nothing in the product creates, switches or removes worktrees any more.

## The allow-list boundary
- `isPathWithinRoots()` (`lib/path-security.ts`) is the single implementation behind
  `isFilePathAllowed()`, and it is the security boundary: keep it the only one. It re-resolves and
  case-folds both sides, so either path form authorizes.
- `isExistingPathWithinRoots()` refuses any path with a `..` segment
  (`hasParentDirectorySegment()`). In `/api/files/[...path]` URL parsing drops literal `..`
  segments, and the route refuses an encoded slash inside a segment (`link%2F..%2Fx`).
- `/api/files/...?sessionId=` also reads (never lists) a file outside the roots when that exact
  path appears in the session, so a chat link opens (`lib/session-file-references-core.ts`).
  Tools are matched by name: keep that list in step with `CODING_TOOL_NAMES`.
- git prints POSIX-style absolute paths even on Windows. Every path read from git goes through
  `toNativePath()` (`lib/paths.ts`) and is compared with `samePath()`, never `===`.
- What `type=list` leaves out is visibility, never access (`lib/file-tree-visibility.ts`): hidden
  entries stay readable by path.
- A directory link (symlink or junction) is authorized by where it resolves, never by its lexical
  path (`lib/linked-directory.ts`). One that leads outside every root is listed but refused beneath
  it until the explorer's allow action (`?type=allow-link`, `allowOutsideLink()` in
  `components/FileExplorer.tsx`) grants its target.

## Uploads and chat drops
- The explorer's Upload button and a non-image file dropped onto the chat share one client,
  `uploadFiles()` (`lib/file-upload-client.ts`), and one endpoint,
  `POST /api/files/<cwd>?type=upload`. Never add a second write path for drops. A chat drop uses
  `conflict=skip`, so it never replaces a file.
- Dropped images still attach to the prompt. Folders are left out with a notice: the endpoint
  writes flat file names only (`validateUploadFileNames()`).
