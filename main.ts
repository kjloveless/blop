import { sprintf } from "@std/fmt/printf";

const VERSION: string = "0.0.1";
const TAB_STOP: number = 8;
const QUIT_TIMES: number = 3;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const cbreak = true;
let bytesWritten = 0;

interface EditorConfig {
  cursorX: number;
  cursorY: number;
  renderX: number;
  rowOffset: number;
  colOffset: number;
  screenRows: number;
  screenCols: number;
  numRows: number;
  row: string[];
  render: string[];
  dirty: number;
  quitTimes: number;
  filename: string;
  statusMsg: string;
  statusMsgTime: Date;
}

enum EditorKey {
  BACKSPACE = 127,
  ARROW_LEFT = 1000,
  ARROW_RIGHT,
  ARROW_UP,
  ARROW_DOWN,
  DEL_KEY,
  HOME_KEY,
  END_KEY,
  PAGE_UP,
  PAGE_DOWN,
}

let e: EditorConfig;
let appendBuffer: string = "";

function abAppend(msg: string) {
  appendBuffer += msg;
}

function abFree() {
  appendBuffer = "";
}

function exit(msg: string, code: number = 0) {
  resetScreen();

  // TODO: fix how bytes are being accumulated
  // console.log(`${bytesWritten} bytes written this session!\r\n${msg}\r\n`);
  console.log(`${msg}\r\n`);

  Deno.stdin.close();
  Deno.stdout.close();

  Deno.exit(code);
}

function enableRawMode() {
  // TODO: move cbreak config to .env
  if (cbreak) console.log("signal breaking is on");
  if (Deno.stdin.isTerminal()) {
    Deno.stdin.setRaw(true, { cbreak });
  } else {
    console.error("please run me in a terminal");
    exit("error: enableRawMode() not a terminal", -1);
  }
}

// pretty sure Deno disables raw mode, but we like safety
function _disableRawMode() {
  Deno.stdin.setRaw(false);
}

// sync reading... cuz we kinda need some input...
function editorReadKey(): number {
  const buffer = new Uint8Array(1);
  let bytesRead: number = 0;

  while (bytesRead != 1) {
    bytesRead += Deno.stdin.readSync(buffer) ?? 0;
  }

  const buff = decoder.decode(buffer);
  if (buff[0] == "\x1b") {
    const sequence = new Uint8Array(3);

    bytesRead += Deno.stdin.readSync(sequence) ?? 0;

    const seq = decoder.decode(sequence);
    if (seq[0] == "[") {
      if (seq[1] >= "0" && seq[1] <= "9") {
        if (seq[2] == "~") {
          switch (seq[1]) {
            case "1":
              return EditorKey.HOME_KEY;
            case "3":
              return EditorKey.DEL_KEY;
            case "4":
              return EditorKey.END_KEY;
            case "5":
              return EditorKey.PAGE_UP;
            case "6":
              return EditorKey.PAGE_DOWN;
            case "7":
              return EditorKey.HOME_KEY;
            case "8":
              return EditorKey.END_KEY;
          }
        }
      } else {
        switch (seq[1]) {
          case "A":
            return EditorKey.ARROW_UP;
          case "B":
            return EditorKey.ARROW_DOWN;
          case "C":
            return EditorKey.ARROW_RIGHT;
          case "D":
            return EditorKey.ARROW_LEFT;
          case "H":
            return EditorKey.HOME_KEY;
          case "F":
            return EditorKey.END_KEY;
        }
      }
    } else if (seq[0] == "O") {
      switch (seq[1]) {
        case "H":
          return EditorKey.HOME_KEY;
        case "F":
          return EditorKey.END_KEY;
      }
    }

    return 0x1b;
  } else {
    return buffer[0];
  }
}

// TODO: gonna see if i end up needing this... it's not fully implemented
// either
function _getCursorPosition(): boolean {
  const buffer = new Uint8Array(32);
  let i = 0;

  write("\x1b[6n");

  while (i < buffer.length - 1) {
    Deno.stdin.read(buffer);
    const data = decoder.decode(buffer);
    if (data[i] == "R") break;
    i++;
  }

  if (buffer[0] != "\x1b".charCodeAt(0) || buffer[1] != "[".charCodeAt(0)) {
    return false;
  }
  write(buffer);

  return true;
}

function getWindowSize() {
  const { columns, rows } = Deno.consoleSize();
  return { columns, rows };
}

function editorRowCursorXtoRenderX(cursorX: number): number {
  let renderX = 0;

  for (let i = 0; i < cursorX; i++) {
    if (e.row[e.cursorY][i] == "\t") {
      renderX += (TAB_STOP - 1) - (renderX % TAB_STOP);
    }
    renderX++;
  }

  return renderX;
}

function editorUpdateRow(at: number) {
  let i = 0;
  e.render[at] = "";
  while (i < e.row[at].length) {
    if (e.row[at] == "\t") {
      e.render[at] = " ".repeat(TAB_STOP);
    } else {
      e.render[at] += e.row[at][i];
    }
    i++;
  }
}

function editorInsertRow(at: number, msg: string) {
  if (at < 0 || at > e.numRows) return;

  e.row.splice(at, 0, msg);

  editorUpdateRow(at);

  e.numRows++;
  e.dirty++;
}

function editorFreeRow(row: number) {
  e.row[row] = "";
  e.render[row] = "";
}

function editorDelRow(at: number) {
  if (at < 0 || at >= e.numRows) return;

  editorFreeRow(at);
  e.row.splice(at, 1);
  e.numRows--;
  e.dirty++;
}

function editorRowInsertChar(row: number, at: number, char: string) {
  if (at < 0 || at > e.row[row].length) at = e.row[row].length;

  e.row[row] = e.row[row].slice(0, at) + char + e.row[row].slice(at);
  editorUpdateRow(row);
  e.dirty++;
}

function editorRowAppendString(row: number, msg: string) {
  e.row[row] += msg;
  editorUpdateRow(e.cursorY);
  e.dirty++;
}

function editorRowDelChar(row: number, at: number) {
  if (at < 0 || at >= e.row[row].length) return;

  e.row[row] = e.row[row].slice(0, at) + e.row[row].slice(at + 1);
  editorUpdateRow(row);
  e.dirty++;
}

function editorInsertChar(char: string) {
  if (e.cursorY == e.numRows) {
    editorInsertRow(e.numRows, "");
  }
  editorRowInsertChar(e.cursorY, e.cursorX, char);
  e.cursorX++;
}

function editorInsertNewline() {
  if (e.cursorX == 0) {
    editorInsertRow(e.cursorY, "");
  } else {
    const row = e.row[e.cursorY];
    editorInsertRow(e.cursorY + 1, row.slice(e.cursorX));
    e.row[e.cursorY] = e.row[e.cursorY].slice(0, e.cursorX);
    editorUpdateRow(e.cursorY);
  }
  e.cursorY++;
  e.cursorX = 0;
}

function editorDelChar() {
  if (e.cursorY == e.numRows) return;
  if (e.cursorX == 0 && e.cursorY == 0) return;

  if (e.cursorX > 0) {
    editorRowDelChar(e.cursorY, e.cursorX - 1);
    e.cursorX--;
  } else {
    e.cursorX = e.row[e.cursorY - 1].length;
    editorRowAppendString(e.cursorY - 1, e.row[e.cursorY]);
    editorDelRow(e.cursorY);
    e.cursorY--;
    //console.log(`\n\n\n\nhere: ${e.row}`)
    //Deno.exit();
  }
}

function editorRowsToString(): string {
  const rows = e.row.length;

  let contents = "";
  for (let i = 0; i < rows; i++) {
    contents += e.row[i] + "\n";
  }

  return contents;
}

async function editorSave() {
  if (e.filename == "" || e.filename == undefined) {
    e.filename = editorPrompt("Save as: %s (ESC to cancel)");
    if (!e.filename) {
      editorSetStatusMessage("Save aborted");
      return;
    }
  }

  const data = encoder.encode(editorRowsToString());
  await Deno.writeFile(e.filename, data, { mode: 0o644 });
  e.dirty = 0;
  editorSetStatusMessage(`${data.length} bytes written to disk`);
}

function editorOpen(filename: string) {
  console.log(`filename: ${filename}`);
  e.filename = filename;
  const data = Deno.readFileSync(filename);
  const contents = decoder.decode(data).trimEnd();
  const lines = contents.split("\n");

  for (let i = 0; i < lines.length; i++) {
    editorInsertRow(e.numRows, lines[i]);
  }
  e.dirty = 0;
}

function resetScreen() {
  write("\x1b[2J", true);
  write("\x1b[H", true);
}

function editorScroll() {
  e.renderX = 0;
  if (e.cursorY < e.numRows) {
    e.renderX = editorRowCursorXtoRenderX(e.cursorX);
  }

  if (e.cursorY < e.rowOffset) {
    e.rowOffset = e.cursorY;
  }
  if (e.cursorY >= e.rowOffset + e.screenRows) {
    e.rowOffset = e.cursorY - e.screenRows + 1;
  }
  if (e.renderX < e.colOffset) {
    e.colOffset = e.renderX;
  }
  if (e.renderX >= e.colOffset + e.screenCols) {
    e.colOffset = e.renderX - e.screenCols + 1;
  }
}

function editorDrawRows() {
  for (let y = 0; y < e.screenRows; y++) {
    abAppend("\x1b[K");
    const fileRow = y + e.rowOffset;
    if (fileRow >= e.numRows) {
      if (e.numRows == 0 && y == Math.floor(e.screenRows / 3)) {
        const welcome = `editor -- version ${VERSION}`;
        let padding = Math.floor((e.screenCols - welcome.length) / 2);
        if (padding > 0) {
          abAppend("~");
          padding--;
        }
        while (padding--) {
          abAppend(" ");
        }
        abAppend(welcome);
      } else {
        abAppend("~");
      }
    } else {
      let len = e.row[fileRow].length - e.colOffset;
      if (len < 0) len = 0;
      if (len > e.screenCols) len = e.screenCols;
      if (len > 0) {
        abAppend(e.row[fileRow].slice(e.colOffset, e.colOffset + len));
      }
    }

    abAppend("\r\n");
  }
}

function editorDrawStatusBar() {
  abAppend("\x1b[7m");

  const status = `${
    e.filename != "" ? e.filename : "[No Name]"
  } - ${e.numRows} lines ${ e.dirty != 0 ? "(modified)" : "" }`;
  abAppend(status);

  const rStatus = `${e.cursorY + 1}/${e.numRows}`;

  for (let len = status.length; len < e.screenCols; len++) {
    if (e.screenCols - len == rStatus.length) {
      abAppend(rStatus);
      break;
    } else {
      abAppend(" ");
    }
  }
  abAppend("\x1b[m");
  abAppend("\r\n");
}

function editorDrawMessageBar() {
  abAppend("\x1b[K");
  if (
    (e.statusMsg.length > 0) &&
    ((new Date().getTime() - e.statusMsgTime.getTime()) < 5000)
  ) {
    abAppend(e.statusMsg);
  }
}

function editorRefreshScreen() {
  editorScroll();

  abAppend("\x1b[?25l");
  abAppend("\x1b[H");

  editorDrawRows();
  editorDrawStatusBar();
  editorDrawMessageBar();

  const yPos = `${(e.cursorY - e.rowOffset) + 1}`;
  const xPos = `${(e.renderX - e.colOffset) + 1}`;
  const cursorPosition: string = `\x1b[${yPos};${xPos}H`;
  abAppend(cursorPosition);

  abAppend("\x1b[?25h");

  write(appendBuffer, true);
  abFree();
}

function editorSetStatusMessage(msg: string) {
  e.statusMsg = msg;
  e.statusMsgTime = new Date();
}

function editorPrompt(prompt: string) {
  let buffer = "";

  while (true) {
    const msg = sprintf(prompt, buffer);
    editorSetStatusMessage(msg);
    editorRefreshScreen();

    const char = editorReadKey();
    if (char == EditorKey.DEL_KEY || 
        char == ctrlKey('h') || 
        char == EditorKey.BACKSPACE) {
      if (buffer.length != 0) {
        buffer = buffer.slice(0, buffer.length - 1);
      }
    } else if (char == '\x1b'.charCodeAt(0)) {
      editorSetStatusMessage("");
      return;
    } else if (char == '\r'.charCodeAt(0)) {
      if (buffer.length != 0) {
        editorSetStatusMessage("");
        return buffer;
      }
    } else if (!isCntrl(char) && char < 128) {
      buffer += String.fromCharCode(char);
    }
  }
}

function editorMoveCursor(key: string | number) {
  let row = (e.cursorY >= e.numRows) ? undefined : e.row[e.cursorY];
  switch (key) {
    case EditorKey.ARROW_LEFT:
      if (e.cursorX != 0) {
        e.cursorX--;
      } else if (e.cursorY > 0) {
        e.cursorY--;
        e.cursorX = e.row[e.cursorY].length;
      }
      break;
    case EditorKey.ARROW_RIGHT:
      if (row != undefined && e.cursorX < row.length) {
        e.cursorX++;
      } else if (row != undefined && e.cursorX == row.length) {
        e.cursorY++;
        e.cursorX = 0;
      }
      break;
    case EditorKey.ARROW_UP:
      if (e.cursorY != 0) {
        e.cursorY--;
      }
      break;
    case EditorKey.ARROW_DOWN:
      if (e.cursorY < e.numRows) {
        e.cursorY++;
      }
      break;
  }

  row = (e.cursorY >= e.numRows) ? undefined : e.row[e.cursorY];
  const rowLen = row != undefined ? row.length : 0;
  if (e.cursorX > rowLen) {
    e.cursorX = rowLen;
  }
}

async function editorProcessKeypress() {
  const char = editorReadKey();

  switch (char) {
    case "\r".charCodeAt(0):
      editorInsertNewline();
      break;
    case ctrlKey("q"):
      if (e.dirty != 0 && e.quitTimes > 0) {
        editorSetStatusMessage(`WARNING!!! File has unsaved changes. Press Ctrl-Q ${e.quitTimes} more times to quit`);
        e.quitTimes--;
        return;
      }
      exit("ciao, ciao");
      break;

    case ctrlKey("s"):
      await editorSave();
      break;

    case EditorKey.HOME_KEY:
      e.cursorX = 0;
      break;

    case EditorKey.END_KEY:
      if (e.cursorY < e.numRows) {
        e.cursorX = e.row[e.cursorY].length;
      }
      break;

    case EditorKey.BACKSPACE:
    case EditorKey.DEL_KEY:
    case ctrlKey("h"):
      if (char == EditorKey.DEL_KEY) editorMoveCursor(EditorKey.ARROW_RIGHT);
      editorDelChar();
      break;

    case EditorKey.PAGE_UP:
    case EditorKey.PAGE_DOWN: {
      if (char == EditorKey.PAGE_UP) {
        e.cursorY = e.rowOffset;
      } else if (char == EditorKey.PAGE_DOWN) {
        e.cursorY = e.rowOffset + e.screenRows - 1;
        if (e.cursorY > e.numRows) {
          e.cursorY = e.numRows;
        }
      }

      let times = e.screenRows;
      while (times--) {
        editorMoveCursor(
          char == EditorKey.PAGE_UP ? EditorKey.ARROW_UP : EditorKey.ARROW_DOWN,
        );
      }
      break;
    }

    case EditorKey.ARROW_UP:
    case EditorKey.ARROW_DOWN:
    case EditorKey.ARROW_LEFT:
    case EditorKey.ARROW_RIGHT:
      editorMoveCursor(char);
      break;

    case ctrlKey("l"):
    case 0x1b:
      break;

    default:
      editorInsertChar(String.fromCharCode(char));
      break;
  }

  e.quitTimes = QUIT_TIMES;
}

// Generic write to stdout
// needs to be sync, we need writes to occur in order... or something
function write(bytes: string | Uint8Array, guiBytes: boolean = false) {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  const written = Deno.stdout.writeSync(data);

  if (!guiBytes) bytesWritten += written;
}

function isCntrl(charCode: number): boolean {
  return (charCode < 32 || charCode === 127) ? true : false;
}

function ctrlKey(key: number | string): number {
  return typeof key === "string" ? key.charCodeAt(0) & 0x1f : key & 0x1f;
}

function initEditor() {
  const { columns, rows } = getWindowSize();

  e = {
    cursorX: 0,
    cursorY: 0,
    renderX: 0,
    rowOffset: 0,
    colOffset: 0,
    numRows: 0,
    row: [],
    render: [],
    dirty: 0,
    quitTimes: QUIT_TIMES,
    filename: "",
    statusMsg: "",
    screenCols: columns,
    screenRows: rows - 2,
    statusMsgTime: new Date(),
  };
}

if (import.meta.main) {
  enableRawMode();
  initEditor();
  if (Deno.args.length === 1) {
    editorOpen(Deno.args[0]);
  } else if (Deno.args.length === 3) {
    editorOpen(Deno.args[2]);
  }

  editorSetStatusMessage("HELP: Ctrl-S = save | Ctrl-Q = quit");

  while (true) {
    editorRefreshScreen();
    await editorProcessKeypress();
  }
}
