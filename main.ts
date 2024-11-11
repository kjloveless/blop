const VERSION: string = "0.0.1";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const cbreak = true;
let bytesWritten = 0;

interface EditorConfig {
  cursorX: number;
  cursorY: number;
  screenRows: number;
  screenCols: number;
}

enum EditorKey {
  ARROW_LEFT  = 1000,
  ARROW_RIGHT,
  ARROW_UP,
  ARROW_DOWN,
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
            case '5':
              return EditorKey.PAGE_UP;
              break;
            case '6':
              return EditorKey.PAGE_DOWN;
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
        }
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

function resetScreen() {
  write("\x1b[2J", true);
  write("\x1b[H", true);
}

function editorDrawRows() {
  let y = 0;
  while (y < e.screenRows) {
    if (y == Math.floor(e.screenRows / 3)) {
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

    abAppend("\x1b[K");
    if (y < e.screenRows - 1) {
      abAppend("\r\n");
    }
    y++;
  }
}

function editorRefreshScreen() {
  //resetScreen();
  
  abAppend("\x1b[?25l");
  abAppend("\x1b[H");

  editorDrawRows();

  const cursorPosition: string = `\x1b[${e.cursorY};${e.cursorX}H`;
  abAppend(cursorPosition);

  abAppend("\x1b[?25h");

  write(appendBuffer, true);
  abFree();
}

function editorMoveCursor(key: string | number) {
  switch (key) {
    case EditorKey.ARROW_LEFT:
      if (e.cursorX != 0) {
        e.cursorX--;
      }
      break;
    case EditorKey.ARROW_RIGHT:
      if (e.cursorX != e.screenCols - 1) {
        e.cursorX++;
      }
      break;
    case EditorKey.ARROW_UP:
      if (e.cursorY != 0) {
        e.cursorY--;
      }
      break;
    case EditorKey.ARROW_DOWN:
      if (e.cursorY != e.screenRows - 1) {
        e.cursorY++;
      }
      break;
  }
}

function editorProcessKeypress() {
  const char = editorReadKey();

  switch (char) {
    case ctrlKey('q'):
      exit('ciao, ciao');
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

  const { columns, rows } = getWindowSize();
  e.screenRows = rows;
  e.screenCols = columns;
}

if (import.meta.main) {
  enableRawMode();
  initEditor();

  while(true) {
    editorRefreshScreen();
    editorProcessKeypress();
  }

  exit(`bye!`);
}
