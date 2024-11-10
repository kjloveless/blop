const decoder = new TextDecoder();
const encoder = new TextEncoder();

let bytesWritten = 0;

function exit(msg: string, code: number = 0) {
  console.log(`${bytesWritten} bytes written this session!\r\n${msg}\r\n`);

  Deno.stdin.close();
  Deno.stdout.close();

  Deno.exit(code);
}

function enableRawMode() {
  // TODO: move cbreak config to .env
  if (Deno.stdin.isTerminal) {
    Deno.stdin.setRaw(true, {cbreak: false});
  } else {
    console.error('please run me in a terminal');
    exit("error: enableRawMode() not a terminal", -1);
  }
}

// pretty sure Deno disables raw mode, but we like safety
function disableRawMode() {
  Deno.stdin.setRaw(false);
}

// Generic write to stdout
async function write(bytes: string | Uint8Array) {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  bytesWritten += await Deno.stdout.write(data);
}

function iscntrl(charCode: number): boolean {
  return (charCode < 32 || charCode === 127) ? true : false; 
}

function ctrlKey(key: number | string): number {
  return typeof key === "string" ? key.charCodeAt(0) & 0x1f : key & 0x1f;
}

if (import.meta.main) {
  enableRawMode();

  // raw mode enabled
  for await (const chunk of Deno.stdin.readable) {
    const text = decoder.decode(chunk);
    if (text === 'q') exit('q->exit');

    const charCode = chunk[0];

    if (iscntrl(charCode)) {
      write(`${chunk}\r\n`);
    } else {
      write(`${chunk} ('${text}')\r\n`);
    }

    if (charCode == ctrlKey('q')) break;
  }

  exit(`bye!`);
}
