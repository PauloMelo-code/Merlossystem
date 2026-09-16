import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// O jsdom não implementa matchMedia, e o provedor de tema o consulta no primeiro
// render: sem este stub, toda árvore que passa pelo shell quebra no teste.
if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
