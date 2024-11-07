// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  if (Deno.stdin.isTerminal()) {
      Deno.stdin.setRaw(true);
  }

  const decoder = new TextDecoder();
  for await (const chunk of Deno.stdin.readable) {
      const text = decoder.decode(chunk);
      const charCode = text.charCodeAt(0);
      if (charCode == 3 || charCode == 4) Deno.exit();

      console.log(charCode);

  }

}
