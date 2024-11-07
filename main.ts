export function disableRawMode() {
    Deno.stdin.setRaw(false);
}

export function enableRawMode() {
    Deno.stdin.setRaw(true);
}

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  if (Deno.stdin.isTerminal()) {
      enableRawMode();
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  var bytesWritten = 0;
  for await (const chunk of Deno.stdin.readable) {
      const text = decoder.decode(chunk);
      const charCode = text.charCodeAt(0);
      if (charCode === 3 || charCode === 4) {
          disableRawMode();
          console.log(`\nyou wrote ${bytesWritten} bytes this session!`)
          console.log("bye!");
          Deno.exit();
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
