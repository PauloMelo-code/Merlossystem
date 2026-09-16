import "server-only";

/** API pública do domínio de mídia (03-arquitetura.md §4.1). O resto é privado. */

export { etiquetasDaGaleria, listarMidias, midiaParaLeitura, type MidiaParaLeitura } from "./_consultas";
export { alterarMidia } from "./edicao";
export { lerBinarioDaMidia, type BinarioDaMidia } from "./leitura";
export { receberUpload, type EntradaUpload, type ResultadoUpload } from "./upload";
export {
  agendarDownload,
  baixarAnexo,
  gerarMiniaturaDaMidia,
  guardarMidiaRecebida,
  type DadosDownload,
  type MidiaRecebida,
} from "./ingestao";
export { limparMidiasExpiradas, removerBinarios } from "./limpeza";
export { rotaDaMidia, type EtiquetaDaGaleria, type MidiaDto, type PaginaDeMidias } from "./dto";
