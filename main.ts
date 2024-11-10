const decoder = new TextDecoder();
const encoder = new TextEncoder();

const cbreak = true;
let bytesWritten = 0;

function exit(msg: string, code: number = 0) {
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
  if (cbreak) console.log(`${buffer[0]}`)
  return buffer[0];
}

function editorRefreshScreen() {
  write("\x1b[2J");
  write("\x1b[H");
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
function write(bytes: string | Uint8Array) {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  bytesWritten += Deno.stdout.writeSync(data);
}

function iscntrl(charCode: number): boolean {
  return (charCode < 32 || charCode === 127) ? true : false; 
}

function ctrlKey(key: number | string): number {
  return typeof key === "string" ? key.charCodeAt(0) & 0x1f : key & 0x1f;
}

if (import.meta.main) {
  enableRawMode();

  while(true) {
    editorRefreshScreen();
    editorProcessKeypress();
  }

  exit(`bye!`);
}
