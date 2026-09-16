import { renderSVG } from "uqr";

/**
 * QR do segundo fator, gerado NO SERVIDOR (02-seguranca.md §9.1; 04-ui.md §5.1).
 *
 * A `otpauth://` carrega o SEGREDO do TOTP. Por isso a imagem nasce aqui, no
 * mesmo processo que já conhece o segredo, e não num serviço de QR na internet:
 * a alternativa clássica — montar `<img src="https://api.qrserver.com/...">` —
 * entrega o segundo fator de toda a operação a um terceiro, em texto, na barra
 * de endereço dele.
 *
 * SVG em vez de PNG porque o desenho é vetorial de verdade (escala sem borrar,
 * imprime bem) e porque manter o gerador em JS puro evita dependência nativa no
 * caminho de login.
 *
 * As cores são CRAVADAS em branco e preto, e não seguem o tema: leitor de QR
 * espera módulo escuro sobre fundo claro, e QR invertido falha em boa parte dos
 * aplicativos autenticadores. A moldura (`border`) é a zona de silêncio que a
 * especificação do formato exige — sem ela a câmera não acha o código.
 */
export function qrDeDataUrl(texto: string): string {
  const svg = renderSVG(texto, {
    ecc: "M",
    border: 2,
    whiteColor: "#ffffff",
    blackColor: "#000000",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
