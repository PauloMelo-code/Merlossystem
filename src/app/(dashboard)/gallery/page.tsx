"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Upload, Search, Trash2, Image as ImageIcon, Video, Music, FileText, Sticker, X } from "lucide-react"
import { rotuloDaPasta, rotuloDoTipo } from "@/lib/media/pastas"
import { toast } from "sonner"

interface MediaFile {
  id: string
  originalName: string | null
  fileUrl: string
  thumbnailUrl: string | null
  fileType: string
  mimeType: string | null
  fileSize: number | null
  folder: string
  tags: string[]
  createdAt: string
  product?: { id: string; name: string } | null
}

/**
 * As opcoes dos filtros saem do que EXISTE no acervo, nao de uma lista fixa.
 *
 * A lista fixa daqui oferecia "Lookbooks" e "Stories", que nunca receberam
 * arquivo, e nao tinha nome para o que chega da conversa. Filtro que nao leva
 * a lugar nenhum e pior do que filtro nenhum: a pessoa clica, ve a tela vazia
 * e conclui que o acervo esta vazio.
 */
function opcoes(
  valores: string[],
  rotular: (v: string) => string,
  rotuloDoTodos: string
): { value: string; label: string }[] {
  return [
    { value: "all", label: rotuloDoTodos },
    ...valores.map((v) => ({ value: v, label: rotular(v) })),
  ]
}

function FileTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "image": return <ImageIcon className="h-5 w-5" />
    case "sticker": return <Sticker className="h-5 w-5" />
    case "video": return <Video className="h-5 w-5" />
    case "audio": return <Music className="h-5 w-5" />
    default: return <FileText className="h-5 w-5" />
  }
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function GalleryPage() {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [folder, setFolder] = useState("all")
  const [fileType, setFileType] = useState("all")
  /** Pastas e tipos que existem no acervo — vem da propria rota. */
  const [pastas, setPastas] = useState<string[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFiles = useCallback(async () => {
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    if (folder !== "all") params.set("folder", folder)
    if (fileType !== "all") params.set("fileType", fileType)

    const res = await fetch(`/api/media/gallery?${params}`)
    const data = await res.json()
    setFiles(data.files)
    setTotal(data.total)
    if (Array.isArray(data.pastas)) setPastas(data.pastas)
    if (Array.isArray(data.tipos)) setTipos(data.tipos)
  }, [search, folder, fileType])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)

    let uploaded = 0
    for (const file of Array.from(fileList)) {
      const formData = new FormData()
      formData.append("file", file)
      // "Recebidas na conversa" nao e destino de upload: o que a equipe sobe
      // nao chegou de cliente nenhuma, e marcar assim faria a origem mentir.
      formData.append(
        "folder",
        folder === "all" || folder === "incoming" ? "general" : folder
      )

      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      })

      if (res.ok) uploaded++
    }

    setUploading(false)
    toast.success(`${uploaded} arquivo(s) enviado(s)`)
    loadFiles()
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este arquivo?")) return
    const res = await fetch(`/api/media/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Arquivo excluído")
      loadFiles()
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Galeria de Mídia</h1>
          <p className="text-muted-foreground">{total} arquivo(s)</p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Enviando..." : "Upload"}
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={folder} onValueChange={(v) => setFolder(v || "all")}>
          <SelectTrigger className="w-52">
            {/* Com filho explicito: sem ele este Select mostra o VALOR cru, e o
                filtro aparecia escrito "all" na tela. */}
            <SelectValue placeholder="Pasta">
              {folder === "all" ? "Todas as pastas" : rotuloDaPasta(folder)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {opcoes(pastas, rotuloDaPasta, "Todas as pastas").map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fileType} onValueChange={(v) => setFileType(v || "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tipo">
              {fileType === "all" ? "Todos os tipos" : rotuloDoTipo(fileType)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {opcoes(tipos, rotuloDoTipo, "Todos os tipos").map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
          dragOver ? "border-neutral-900 bg-neutral-100" : "border-neutral-200"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="text-center py-8 text-neutral-600 font-medium">
            Solte os arquivos aqui para fazer upload
          </div>
        )}

        {!dragOver && files.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <ImageIcon className="mx-auto h-12 w-12 mb-3 opacity-30" />
            <p>Nenhum arquivo encontrado</p>
            <p className="text-sm mt-1">Arraste e solte arquivos aqui ou clique em Upload</p>
          </div>
        )}

        {!dragOver && files.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {files.map((file) => (
              <div
                key={file.id}
                className="group relative bg-white rounded-lg border overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setPreviewFile(file)}
              >
                <div className="aspect-square bg-neutral-100 flex items-center justify-center">
                  {file.fileType === "image" || file.fileType === "sticker" ? (
                    <img
                      src={file.thumbnailUrl || file.fileUrl}
                      alt={file.originalName || ""}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileTypeIcon type={file.fileType} />
                  )}
                </div>

                <div className="p-2">
                  <p className="text-xs font-medium truncate">
                    {file.originalName || "Sem nome"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.fileSize)}
                  </p>
                  {file.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {file.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white"
                  aria-label="Excluir mídia"
                  onClick={(e) => { e.stopPropagation(); handleDelete(file.id) }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>

                {/* Tipo e ORIGEM, em portugues. O cartao mostrava "image" e
                    "audio" crus, e nada dizia de onde o arquivo tinha vindo —
                    foto de peca, print da conversa e audio de cliente ficavam
                    indistinguiveis na mesma parede. */}
                <div className="absolute top-1 left-1 flex gap-1">
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-black/50 text-white border-0">
                    {rotuloDoTipo(file.fileType)}
                  </Badge>
                  {file.folder && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-black/35 text-white border-0">
                      {rotuloDaPasta(file.folder)}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{previewFile?.originalName || "Preview"}</span>
              <Button variant="ghost" size="icon" aria-label="Fechar preview" onClick={() => setPreviewFile(null)}>
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="space-y-4">
              <div className="flex items-center justify-center bg-neutral-50 rounded-lg min-h-[300px]">
                {previewFile.fileType === "image" ? (
                  <img
                    src={previewFile.fileUrl}
                    alt={previewFile.originalName || ""}
                    className="max-h-[500px] object-contain"
                  />
                ) : previewFile.fileType === "video" ? (
                  <video src={previewFile.fileUrl} controls className="max-h-[500px]" />
                ) : previewFile.fileType === "audio" ? (
                  <audio src={previewFile.fileUrl} controls className="w-full" />
                ) : (
                  <div className="text-center py-8">
                    <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
                    <a
                      href={previewFile.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline mt-2 block"
                    >
                      Abrir arquivo
                    </a>
                  </div>
                )}
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span>Tipo: {previewFile.mimeType}</span>
                <span>Tamanho: {formatSize(previewFile.fileSize)}</span>
                <span>Pasta: {previewFile.folder}</span>
              </div>
              {previewFile.tags.length > 0 && (
                <div className="flex gap-1">
                  {previewFile.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
