import express, { Request, Response } from "express";
import { exec } from "child_process";
import cors from "cors";

const app = express();
const PORT = 3000;

// Middleware para parsear JSON
app.use(express.json());

// Middleware para permitir CORS
app.use(cors());

// Ruta de prueba
app.get("/", (_req: Request, res: Response) => {
  res.send("🎵 API para convertir YouTube a MP3 funcionando");
});

// Función para manejar la ruta y obtener el MP3
const downloadMP3 = async (req: Request, res: Response): Promise<void> => {
  const { url: videoURL } = req.body;

  if (!videoURL || !/^https:\/\/www\.youtube\.com\/watch\?v=/.test(videoURL)) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  // Limpiar la URL para evitar parámetros innecesarios como 'ab_channel'
  const cleanedURL = videoURL.split("&")[0]; // Esto eliminará todo después del primer '&'

  try {
    const command = `yt-dlp -x --audio-format mp3 ${cleanedURL}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error al ejecutar yt-dlp: ${error.message}`);
        res.status(500).send(`Error al ejecutar yt-dlp: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`❌ Error en stderr: ${stderr}`);
        res.status(500).send(`Error en el proceso: ${stderr}`);
        return;
      }

      console.log(`🎵 Audio descargado con éxito: ${stdout}`);
      res.send("Audio descargado correctamente.");
    });
  } catch (error) {
    console.error("❌ Error general:", error);
    res.status(500).send("Ocurrió un error al procesar la solicitud");
  }
};

// Ruta para descargar MP3 usando la función POST
app.post("/download", downloadMP3);

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en el puerto ${PORT}`);
});
