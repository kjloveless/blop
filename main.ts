const VERSION: string = "0.0.1";
const TAB_STOP: number = 8;

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
  let i = 0;

  while (i < cursorX) {
    if (e.row[e.cursorY][i] == "\t") {
      renderX += (TAB_STOP - 1) - (renderX % TAB_STOP);
    }
    renderX++;
    i++;
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

function editorAppendRow(msg: string) {
  const at = e.numRows;
  e.row[at] = msg;

  editorUpdateRow(at);

  e.numRows++;
}

function editorRowInsertChar(row: number, at: number, char: string) {
  if (at < 0 || at > e.row[row].length) at = e.row[row].length;

  e.row[row] = e.row[row].slice(0, at) + char + e.row[row].slice(at);
  editorUpdateRow(row);
}

function editorInsertChar(char: string) {
  if (e.cursorY == e.numRows) {
    editorAppendRow("");
  }
  editorRowInsertChar(e.cursorY, e.cursorX, char);
  e.cursorX++;
}

function editorRowsToString(): string {
  const rows = e.row.length;

  let i = 0;
  let contents = "";
  while (i < rows) {
    contents += e.row[i] + "\n";
    i++;
  }

  return contents;
}

async function editorSave() {
  if (e.filename == "" || e.filename == undefined) return;

  const data = encoder.encode(editorRowsToString());
  await Deno.writeFile(e.filename, data, { mode: 0o644 });
}

function editorOpen(filename: string) {
  console.log(`filename: ${filename}`);
  e.filename = filename;
  const data = Deno.readFileSync(filename);
  const contents = decoder.decode(data).trimEnd();
  const lines = contents.split("\n");

  let i = 0;
  while (i < lines.length) {
    editorAppendRow(lines[i]);
    i++;
  }
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
  let y = 0;
  while (y < e.screenRows) {
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
    y++;
  }
}

function editorDrawStatusBar() {
  abAppend("\x1b[7m");

  const status = `${
    e.filename != "" ? e.filename : "[No Name]"
  } - ${e.numRows} lines`;
  abAppend(status);

  const rStatus = `${e.cursorY + 1}/${e.numRows}`;

  let len = status.length;
  while (len < e.screenCols) {
    if (e.screenCols - len == rStatus.length) {
      abAppend(rStatus);
      break;
    } else {
      abAppend(" ");
      len++;
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
      // TODO
      break;
    case ctrlKey("q"):
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
      // TODO
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
}

// Generic write to stdout
// needs to be sync, we need writes to occur in order... or something
function write(bytes: string | Uint8Array, guiBytes: boolean = false) {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  const written = Deno.stdout.writeSync(data);

  if (!guiBytes) bytesWritten += written;
}

// TODO: figure out if i want to keep this around
function _iscntrl(charCode: number): boolean {
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

  editorSetStatusMessage("HELP: Ctrl-Q = quit");

  while (true) {
    editorRefreshScreen();
    await editorProcessKeypress();
  }
}
