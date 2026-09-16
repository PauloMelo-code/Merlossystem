/**
 * Entrega um arquivo gerado pela action ao navegador. Sem rota nova: o
 * conteúdo volta no corpo da Server Action (POST, nunca em cache) e vira Blob
 * aqui — nenhum link com dado pessoal fica no histórico nem no servidor.
 */
export function baixarArquivo(nome: string, conteudo: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const ancora = document.createElement("a");
  ancora.href = url;
  ancora.download = nome;
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  URL.revokeObjectURL(url);
}

/** `2026-09-16` no fuso do navegador, para o nome do arquivo. */
export function hojeParaArquivo(agora: Date = new Date()): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}`;
}
