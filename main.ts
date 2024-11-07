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
  for await (const chunk of Deno.stdin.readable) {
      const text = decoder.decode(chunk);
      const charCode = text.charCodeAt(0);
      if (charCode == 3 || charCode == 4) {
          disableRawMode();
          console.log("bye!");
          Deno.exit();
      }

      console.log(charCode);

  }

}
