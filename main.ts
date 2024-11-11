const decoder = new TextDecoder();
const encoder = new TextEncoder();

const cbreak = true;
let bytesWritten = 0;

interface EditorConfig {
  screenRows: number;
  screenCols: number;
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
  return buffer[0];
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
    abAppend("~");

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

  abAppend("\x1b[H");
  abAppend("\x1b[?25h");

  write(appendBuffer, true);
  abFree();
}

function editorProcessKeypress() {
  const char = editorReadKey();

  switch (char) {
    case ctrlKey('q'):
      exit('q->exit');
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
