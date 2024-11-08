export function disableRawMode() {
  Deno.stdin.setRaw(false);
}

export function enableRawMode() {
  Deno.stdin.setRaw(true);
}

function exit(msg: string, code: number = 0) {
  console.log(msg);
  Deno.exit(code);
}

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  if (Deno.stdin.isTerminal()) {
    enableRawMode();
  } else {
    exit(`this isn't a tty, sorry!`);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  var bytesWritten = 0;
  for await (const chunk of Deno.stdin.readable) {
    const text = decoder.decode(chunk);
    const charCode = text.charCodeAt(0);

    if (charCode === 27) {
      let i = 0;
      while (i < chunk.length) {
        console.log(chunk[i]);
        i += 1;
      }
      continue;
    }

    if (charCode === 3 || charCode === 4) {
      disableRawMode();
      console.log(`\nyou wrote ${bytesWritten} bytes this session!`);
      exit(`bye`);
    }

    if (charCode < 32 || charCode > 126) {
      console.log(`\nchar code: ${charCode}`);
    }

    if (charCode === 13) {
      await Deno.stdout.write(encoder.encode("\n"));
    }

    bytesWritten += await Deno.stdout.write(chunk);
  }
}
