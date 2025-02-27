# Usa una imagen base de Node.js
FROM node:20-slim

# Crea y establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias de Node.js
COPY package.json package-lock.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código de tu API
COPY . .

# Expón el puerto en el que tu API va a correr
EXPOSE 3000

# Inicia tu aplicación
CMD ["npm", "start"]
