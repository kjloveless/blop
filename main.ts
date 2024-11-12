const VERSION: string = "0.0.1";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const cbreak = true;
let bytesWritten = 0;

interface EditorConfig {
  cursorX: number;
  cursorY: number;
  rowOffset: number;
  colOffset: number;
  screenRows: number;
  screenCols: number;
  numRows: number;
  row: string[];
}

enum EditorKey {
  ARROW_LEFT  = 1000,
  ARROW_RIGHT,
  ARROW_UP,
  ARROW_DOWN,
  DEL_KEY,
  HOME_KEY,
  END_KEY,
  PAGE_UP,
  PAGE_DOWN,
}

const e: EditorConfig = {};
let appendBuffer: string = "";

function abAppend(msg: string) {
  appendBuffer += msg;
}

function abFree() {
  appendBuffer = "";
}

function exit(msg: string, code: number = 0) {
  resetScreen();

  console.log(`${bytesWritten} bytes written this session!\r\n${msg}\r\n`);

  Deno.stdin.close();
  Deno.stdout.close();

  Deno.exit(code);
}

function enableRawMode() {
  // TODO: move cbreak config to .env
  if (cbreak) console.log('signal breaking is on');
  if (Deno.stdin.isTerminal) {
    Deno.stdin.setRaw(true, {cbreak});
  } else {
    console.error('please run me in a terminal');
    exit("error: enableRawMode() not a terminal", -1);
  }
}

// pretty sure Deno disables raw mode, but we like safety
function disableRawMode() {
  Deno.stdin.setRaw(false);
}

// sync reading... cuz we kinda need some input...
function editorReadKey(): number {
  const buffer = new Uint8Array(1);
  let bytesRead: number = 0;

  while (bytesRead != 1) {
    bytesRead = Deno.stdin.readSync(buffer);
  }

  const buff = decoder.decode(buffer);
  if (buff[0] == '\x1b') {
    const sequence = new Uint8Array(3);

    bytesRead = Deno.stdin.readSync(sequence);

    const seq = decoder.decode(sequence);
    if(seq[0] == '[') {
      if (seq[1] >= '0' && seq[1] <= '9') {
        if (seq[2] == '~') {
          switch (seq[1]) {
            case '1':
              return EditorKey.HOME_KEY;
              break;
            case '3':
              return EditorKey.DEL_KEY;
              break;
            case '4':
              return EditorKey.END_KEY;
              break;
            case '5':
              return EditorKey.PAGE_UP;
              break;
            case '6':
              return EditorKey.PAGE_DOWN;
              break;
            case '7':
              return EditorKey.HOME_KEY;
              break;
            case '8':
              return EditorKey.END_KEY;
              break;
          }
        }
      } else {
        switch (seq[1]) {
          case 'A':
            return EditorKey.ARROW_UP;
            break;
          case 'B':
            return EditorKey.ARROW_DOWN;
            break;
          case 'C':
            return EditorKey.ARROW_RIGHT;
            break;
          case 'D':
            return EditorKey.ARROW_LEFT
            break;
          case 'H':
            return EditorKey.HOME_KEY;
            break;
          case 'F':
            return EditorKey.END_KEY;
        }
      }
    } else if (seq[0] == 'O') {
      switch (seq[1]) {
        case 'H':
          return EditorKey.HOME_KEY;
          break;
        case 'F':
          return EditorKey.END_KEY;
          break;
      }
    }

    return 0x1b;
  } else {
    return buffer[0];
  }
}

function getCursorPosition(): boolean {
  const buffer = new Uint8Array(32);
  let i = 0;

  write("\x1b[6n");

  while (i < buffer.length - 1) {
    Deno.stdin.read(buffer);
    const data = decoder.decode(buffer);
    if (data[i] == 'R') break;
    i++;
  }

  if (buffer[0] != '\x1b' || buffer[1] != '[') return false;
  write(buffer);

  return true;
}

function getWindowSize() {
  const { columns, rows } = Deno.consoleSize();
  return { columns, rows };
}

function editorAppendRow(msg: string) {
  const at = e.numRows;
  e.row[at] = msg;
  e.numRows++;
}

function editorOpen(filename: string) {
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
  if (e.cursorY < e.rowOffset) {
    e.rowOffset = e.cursorY;
  }
  if (e.cursorY >= e.rowOffset + e.screenRows) {
    e.rowOffset = e.cursorY - e.screenRows + 1;
  }
  if (e.cursorX < e.colOffset) {
    e.colOffset = e.cursorX;
  }
  if (e.cursorX >= e.colOffset + e.screenCols) {
    e.colOffset = e.cursorX - e.screenCols + 1;
  }
}

function editorDrawRows() {
  let y = 0;
  while (y < e.screenRows) {
    const fileRow = y + e.rowOffset;
    if (fileRow >= e.numRows) {
      if (e.numRows == 0 && y == Math.floor(e.screenRows / 3)) {
        const welcome = `editor -- version ${VERSION}`;
        let padding = Math.floor((e.screenCols - welcome.length) / 2);
        if (padding > 0 ) {
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

    abAppend("\x1b[K");
    if (y < e.screenRows - 1) {
      abAppend("\r\n");
    }
    y++;
  }
}

function editorRefreshScreen() {
  editorScroll();
  
  abAppend("\x1b[?25l");
  abAppend("\x1b[H");

  editorDrawRows();

  const yPos = `${(e.cursorY - e.rowOffset) + 1}`;
  const xPos = `${(e.cursorX - e.colOffset) + 1}`;
  const cursorPosition: string = `\x1b[${yPos};${xPos}H`;
  abAppend(cursorPosition);

  abAppend("\x1b[?25h");

  write(appendBuffer, true);
  abFree();
}

function editorMoveCursor(key: string | number) {
  let row = (e.cursorY >= e.numRows) ? "" : e.row[e.cursorY];
  switch (key) {
    case EditorKey.ARROW_LEFT:
      if (e.cursorX != 0) {
        e.cursorX--;
      }
      break;
    case EditorKey.ARROW_RIGHT:
      if (row != "" && e.cursorX < row.length) {
        e.cursorX++;
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

  row = (e.cursorY >= e.numRows) ? "" : e.row[e.cursorY];
  const rowLen = row != "" ? row.length : 0;
  if (e.cursorX > rowLen) {
    e.cursorX = rowLen;
  }
}

function editorProcessKeypress() {
  const char = editorReadKey();

  switch (char) {
    case ctrlKey('q'):
      exit('ciao, ciao');
      break;

    case EditorKey.HOME_KEY:
      e.cursorX = 0;
      break;

    case EditorKey.END_KEY:
      e.cursorX = e.screenCols - 1;
      break;

    case EditorKey.PAGE_UP:
    case EditorKey.PAGE_DOWN:
      let times = e.screenRows;
      while (times--) {
        editorMoveCursor(char == EditorKey.PAGE_UP ? EditorKey.ARROW_UP : EditorKey.ARROW_DOWN);
      }
      break;

    case EditorKey.ARROW_UP:
    case EditorKey.ARROW_DOWN:
    case EditorKey.ARROW_LEFT:
    case EditorKey.ARROW_RIGHT:
      editorMoveCursor(char);
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

function iscntrl(charCode: number): boolean {
  return (charCode < 32 || charCode === 127) ? true : false; 
}

function ctrlKey(key: number | string): number {
  return typeof key === "string" ? key.charCodeAt(0) & 0x1f : key & 0x1f;
}

function initEditor() {
  e.cursorX = 0;
  e.cursorY = 0;
  e.rowOffset = 0;
  e.colOffset = 0;
  e.numRows = 0;
  e.row = [];

  const { columns, rows } = getWindowSize();
  e.screenRows = rows;
  e.screenCols = columns;
}

if (import.meta.main) {
  enableRawMode();
  initEditor();
  if (Deno.args.length > 0) {
    editorOpen(Deno.args[0]);
  }

  while(true) {
    editorRefreshScreen();
    editorProcessKeypress();
  }

  exit(`bye!`);
}
