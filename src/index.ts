import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlp from "yt-dlp-exec";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = 3000;
const baseDownloadDir = path.join(__dirname, "downloads");

app.use(express.json());
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  })
);

// Crea la carpeta base si no existe
if (!fs.existsSync(baseDownloadDir)) {
  fs.mkdirSync(baseDownloadDir, { recursive: true });
  console.log("📁 Carpeta de descargas creada:", baseDownloadDir);
}

// Función para limpiar carpeta temporal
async function cleanFolder(folderPath: string) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const fullPath = path.join(folderPath, file);
      fs.unlinkSync(fullPath);
      console.log("🗑️ Eliminado:", fullPath);
    });
    fs.rmdirSync(folderPath);
    console.log("📁 Carpeta temporal eliminada:", folderPath);
  }
}

app.post("/download", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (
    !url ||
    !/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url)
  ) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  const tempDir = path.join(baseDownloadDir, uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });
  console.log("📥 Carpeta temporal:", tempDir);

  try {
    console.log("▶️ Iniciando descarga con yt-dlp...");
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: path.join(tempDir, "%(title)s.%(ext)s"),
      noWarnings: true,
    });

    const files = globSync(`${tempDir}/*.mp3`);
    console.log("🔎 Archivos MP3 encontrados:", files);

    if (files.length === 0) {
      await cleanFolder(tempDir);
      res.status(404).send("❌ No se encontró el archivo MP3");
      return;
    }

    const filePath = files[0];
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    console.log(`📏 Tamaño del archivo: ${stats.size} bytes`);

    if (stats.size < 1000) {
      console.warn("⚠️ Archivo sospechosamente pequeño. Eliminando...");
      await cleanFolder(tempDir);
      res.status(500).send("❌ El archivo MP3 generado es inválido");
      return;
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on("end", async () => {
      console.log("✅ Archivo enviado con éxito:", fileName);
      await cleanFolder(tempDir);
    });

    fileStream.on("error", async (err) => {
      console.error("❌ Error al enviar el archivo:", err);
      await cleanFolder(tempDir);
      res.status(500).send("❌ Error durante la transmisión del archivo");
    });
  } catch (error) {
    console.error("❌ Error general:", error);
    await cleanFolder(tempDir);
    res.status(500).send("❌ Error al procesar el video");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en http://0.0.0.0:${PORT}`);
});
