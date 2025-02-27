"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const child_process_1 = require("child_process");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const PORT = 3000;
// Middleware para parsear JSON
app.use(express_1.default.json());
// Middleware para permitir CORS
app.use((0, cors_1.default)());
// Ruta de prueba
app.get("/", (_req, res) => {
    res.send("🎵 API para convertir YouTube a MP3 funcionando");
});
// Función para manejar la ruta y obtener el MP3
const downloadMP3 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url: videoURL } = req.body;
    if (!videoURL || !/^https:\/\/www\.youtube\.com\/watch\?v=/.test(videoURL)) {
        res.status(400).send("❌ URL de YouTube no válida");
        return;
    }
    // Limpiar la URL para evitar parámetros innecesarios como 'ab_channel'
    const cleanedURL = videoURL.split("&")[0]; // Esto eliminará todo después del primer '&'
    try {
        const command = `yt-dlp -x --audio-format mp3 ${cleanedURL}`;
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
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
    }
    catch (error) {
        console.error("❌ Error general:", error);
        res.status(500).send("Ocurrió un error al procesar la solicitud");
    }
});
// Ruta para descargar MP3 usando la función POST
app.post("/download", downloadMP3);
// Inicia el servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor activo en el puerto ${PORT}`);
});
