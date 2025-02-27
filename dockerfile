# Usar una imagen base de Node.js
FROM node:20.18.0-slim

# Crear y establecer el directorio de trabajo
WORKDIR /app

# Copiar los archivos de configuración de npm
COPY package.json package-lock.json ./

# Instalar pnpm de manera global
RUN npm install -g pnpm

# Instalar dependencias del proyecto
RUN npm ci --include=dev

# Copiar el código fuente del proyecto
COPY . .

# Ejecutar el build
RUN npm run build

# Exponer el puerto de la API
EXPOSE 3000

# Iniciar la aplicación
CMD ["npm", "start"]
