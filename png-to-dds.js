/**
 * PngToDdsConverter - Конвертирует PNG изображение в DDS формат с DXT5 компрессией
 * Основано на спецификации DDS из CodeWalker и Folder2YTD
 */
class PngToDdsConverter {
    constructor() {
        // DDS константы из CodeWalker
        this.DDS_MAGIC = 0x20534444; // "DDS "
        this.DDS_HEADER_SIZE = 124;
        this.DDS_HEADER_DXT10_SIZE = 20;
        
        // Flags
        this.DDSD_CAPS = 0x00000001;
        this.DDSD_HEIGHT = 0x00000002;
        this.DDSD_WIDTH = 0x00000004;
        this.DDSD_PITCH = 0x00000008;
        this.DDSD_PIXELFORMAT = 0x00001000;
        this.DDSD_MIPMAPCOUNT = 0x00020000;
        this.DDSD_LINEARSIZE = 0x00080000;
        this.DDSD_DEPTH = 0x00800000;
        
        // Pixel format flags
        this.DDPF_FOURCC = 0x00000004;
        this.DDPF_RGB = 0x00000040;
        this.DDPF_RGBA = 0x00000041;
        this.DDPF_ALPHAPIXELS = 0x00000001;
        
        // Caps
        this.DDSCAPS_COMPLEX = 0x00000008;
        this.DDSCAPS_TEXTURE = 0x00001000;
        this.DDSCAPS_MIPMAP = 0x00400000;
        
        // FourCC коды
        this.FOURCC_DXT5 = this.makeFourCC('D', 'X', 'T', '5');
    }
    
    /**
     * Создает FourCC код из 4 символов
     */
    makeFourCC(ch0, ch1, ch2, ch3) {
        return ((ch0.charCodeAt(0) & 0xFF) |
                ((ch1.charCodeAt(0) & 0xFF) << 8) |
                ((ch2.charCodeAt(0) & 0xFF) << 16) |
                ((ch3.charCodeAt(0) & 0xFF) << 24)) >>> 0;
    }
    
    /**
     * Вычисляет количество мипмап уровней
     */
    calculateMipLevels(width, height) {
        return Math.floor(Math.log2(Math.max(width, height))) + 1;
    }
    
    /**
     * Конвертирует RGBA пиксели в DXT5 блок
     * DXT5 использует 16 байт на блок 4x4 пикселей:
     * - 8 байт для альфа канала (2 референсных значения + 48 бит интерполяции)
     * - 8 байт для цвета (DXT1 формат)
     */
    encodeDXT5Block(pixels, width, x, y) {
        const block = new Uint8Array(16);
        
        // Извлекаем пиксели блока 4x4
        const alphaValues = [];
        const colors = [];
        
        for (let by = 0; by < 4; by++) {
            for (let bx = 0; bx < 4; bx++) {
                const px = Math.min(x + bx, width - 1);
                const py = Math.min(y + by, pixels.height - 1);
                const idx = (py * pixels.width + px) * 4;
                
                alphaValues.push(pixels.data[idx + 3]); // Alpha
                colors.push({
                    r: pixels.data[idx],
                    g: pixels.data[idx + 1],
                    b: pixels.data[idx + 2],
                    a: pixels.data[idx + 3]
                });
            }
        }
        
        // Кодируем альфа канал
        this.encodeAlphaChannel(block, alphaValues);
        
        // Кодируем цветовой канал (DXT1)
        this.encodeDXT1Color(block, 8, colors);
        
        return block;
    }
    
    /**
     * Кодирует альфа канал для DXT5
     */
    encodeAlphaChannel(block, alphaValues) {
        // Находим минимальное и максимальное значения альфа
        let minAlpha = 255;
        let maxAlpha = 0;
        
        for (let i = 0; i < 16; i++) {
            minAlpha = Math.min(minAlpha, alphaValues[i]);
            maxAlpha = Math.max(maxAlpha, alphaValues[i]);
        }
        
        // Записываем референсные значения
        block[0] = maxAlpha;
        block[1] = minAlpha;
        
        // Вычисляем 6 промежуточных значений
        const alphaTable = new Uint8Array(8);
        alphaTable[0] = maxAlpha;
        alphaTable[1] = minAlpha;
        
        if (maxAlpha > minAlpha) {
            for (let i = 2; i < 8; i++) {
                alphaTable[i] = Math.round(((8 - i) * maxAlpha + (i - 1) * minAlpha) / 7);
            }
        } else {
            for (let i = 2; i < 6; i++) {
                alphaTable[i] = Math.round(((6 - i) * maxAlpha + (i - 1) * minAlpha) / 5);
            }
            alphaTable[6] = 0;
            alphaTable[7] = 255;
        }
        
        // Квантуем каждый пиксель к ближайшему значению в таблице
        let alphaBits = 0n;
        for (let i = 15; i >= 0; i--) {
            let bestIdx = 0;
            let bestDist = Infinity;
            
            for (let j = 0; j < 8; j++) {
                const dist = Math.abs(alphaValues[i] - alphaTable[j]);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = j;
                }
            }
            
            alphaBits |= BigInt(bestIdx) << BigInt(i * 3);
        }
        
        // Записываем биты альфа индексов (6 байт)
        for (let i = 0; i < 6; i++) {
            block[2 + i] = Number((alphaBits >> BigInt(i * 8)) & 0xFFn);
        }
    }
    
    /**
     * Кодирует цвет в формате DXT1
     */
    encodeDXT1Color(block, offset, colors) {
        // Находим минимальный и максимальный цвета
        let minColor = { r: 255, g: 255, b: 255, idx: 0 };
        let maxColor = { r: 0, g: 0, b: 0, idx: 0 };
        
        for (let i = 0; i < 16; i++) {
            const lum = colors[i].r * 0.299 + colors[i].g * 0.587 + colors[i].b * 0.114;
            const minLum = minColor.r * 0.299 + minColor.g * 0.587 + minColor.b * 0.114;
            const maxLum = maxColor.r * 0.299 + maxColor.g * 0.587 + maxColor.b * 0.114;
            
            if (lum < minLum) {
                minColor = { ...colors[i], idx: i };
            }
            if (lum > maxLum) {
                maxColor = { ...colors[i], idx: i };
            }
        }
        
        // Записываем цвета в формате RGB565 (little endian)
        const color0 = ((maxColor.b >> 3) & 0x1F) |
                       (((maxColor.g >> 2) & 0x3F) << 5) |
                       (((maxColor.r >> 3) & 0x1F) << 11);
        
        const color1 = ((minColor.b >> 3) & 0x1F) |
                       (((minColor.g >> 2) & 0x3F) << 5) |
                       (((minColor.r >> 3) & 0x1F) << 11);
        
        block[offset] = color0 & 0xFF;
        block[offset + 1] = (color0 >> 8) & 0xFF;
        block[offset + 2] = color1 & 0xFF;
        block[offset + 3] = (color1 >> 8) & 0xFF;
        
        // Создаем таблицу цветов
        const colorTable = [];
        colorTable[0] = maxColor;
        colorTable[1] = minColor;
        
        if (color0 > color1) {
            // 4 цвета
            for (let i = 2; i < 4; i++) {
                colorTable[i] = {
                    r: Math.round(((4 - i) * maxColor.r + (i - 1) * minColor.r) / 3),
                    g: Math.round(((4 - i) * maxColor.g + (i - 1) * minColor.g) / 3),
                    b: Math.round(((4 - i) * maxColor.b + (i - 1) * minColor.b) / 3)
                };
            }
        } else {
            // 3 цвета + прозрачный
            for (let i = 2; i < 4; i++) {
                colorTable[i] = {
                    r: Math.round(((4 - i) * maxColor.r + (i - 1) * minColor.r) / 3),
                    g: Math.round(((4 - i) * maxColor.g + (i - 1) * minColor.g) / 3),
                    b: Math.round(((4 - i) * maxColor.b + (i - 1) * minColor.b) / 3)
                };
            }
        }
        
        // Квантуем каждый пиксель к ближайшему цвету
        let colorBits = 0;
        for (let i = 15; i >= 0; i--) {
            let bestIdx = 0;
            let bestDist = Infinity;
            
            for (let j = 0; j < 4; j++) {
                const dist = 
                    Math.pow(colors[i].r - colorTable[j].r, 2) +
                    Math.pow(colors[i].g - colorTable[j].g, 2) +
                    Math.pow(colors[i].b - colorTable[j].b, 2);
                
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = j;
                }
            }
            
            colorBits |= bestIdx << (i * 2);
        }
        
        // Записываем биты цветовых индексов (4 байта)
        for (let i = 0; i < 4; i++) {
            block[offset + 4 + i] = (colorBits >> (i * 8)) & 0xFF;
        }
    }
    
    /**
     * Конвертирует ImageData в DDS с DXT5 компрессией
     */
    convert(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        
        // Выравниваем размеры до кратных 4
        const alignedWidth = Math.ceil(width / 4) * 4;
        const alignedHeight = Math.ceil(height / 4) * 4;
        
        // Создаем выровненные данные
        const alignedData = new Uint8ClampedArray(alignedWidth * alignedHeight * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = (y * width + x) * 4;
                const dstIdx = (y * alignedWidth + x) * 4;
                alignedData[dstIdx] = imageData.data[srcIdx];
                alignedData[dstIdx + 1] = imageData.data[srcIdx + 1];
                alignedData[dstIdx + 2] = imageData.data[srcIdx + 2];
                alignedData[dstIdx + 3] = imageData.data[srcIdx + 3];
            }
        }
        
        // Вычисляем размер блока и количество блоков
        const blocksX = Math.ceil(alignedWidth / 4);
        const blocksY = Math.ceil(alignedHeight / 4);
        const mipLevels = this.calculateMipLevels(alignedWidth, alignedHeight);
        
        // Вычисляем общий размер данных
        let totalSize = 0;
        let currentWidth = alignedWidth;
        let currentHeight = alignedHeight;
        
        for (let mip = 0; mip < mipLevels; mip++) {
            const blocksXMip = Math.max(1, Math.ceil(currentWidth / 4));
            const blocksYMip = Math.max(1, Math.ceil(currentHeight / 4));
            totalSize += blocksXMip * blocksYMip * 16; // 16 байт на блок
            currentWidth = Math.max(1, currentWidth >> 1);
            currentHeight = Math.max(1, currentHeight >> 1);
        }
        
        // Создаем буфер для DDS файла
        const headerSize = this.DDS_HEADER_SIZE;
        const ddsBuffer = new ArrayBuffer(headerSize + totalSize);
        const view = new DataView(ddsBuffer);
        const bytes = new Uint8Array(ddsBuffer);
        
        let offset = 0;
        
        // Пишем magic number
        view.setUint32(offset, this.DDS_MAGIC, true);
        offset += 4;
        
        // Пишем основной заголовок
        view.setUint32(offset, this.DDS_HEADER_SIZE, true); // dwSize
        offset += 4;
        
        view.setUint32(offset, 
            this.DDSD_CAPS | this.DDSD_HEIGHT | this.DDSD_WIDTH | 
            this.DDSD_PIXELFORMAT | this.DDSD_MIPMAPCOUNT | this.DDSD_LINEARSIZE, 
            true); // dwFlags
        offset += 4;
        
        view.setUint32(offset, alignedHeight, true); // dwHeight
        offset += 4;
        
        view.setUint32(offset, alignedWidth, true); // dwWidth
        offset += 4;
        
        // dwPitchOrLinearSize
        view.setUint32(offset, alignedWidth * alignedHeight / 2, true);
        offset += 4;
        
        view.setUint32(offset, 0, true); // dwDepth
        offset += 4;
        
        view.setUint32(offset, mipLevels, true); // dwMipMapCount
        offset += 4;
        
        // Зарезервированные байты (44 байта)
        offset += 44;
        
        // Pixel format (32 байта)
        view.setUint32(offset, 32, true); // dwSize
        offset += 4;
        
        view.setUint32(offset, this.DDPF_FOURCC, true); // dwFlags
        offset += 4;
        
        view.setUint32(offset, this.FOURCC_DXT5, true); // dwFourCC
        offset += 4;
        
        // Остальные поля pixel format (20 байт нулей)
        offset += 20;
        
        // Caps
        view.setUint32(offset, this.DDSCAPS_TEXTURE | this.DDSCAPS_COMPLEX, true);
        offset += 4;
        
        view.setUint32(offset, this.DDSCAPS_MIPMAP, true); // dwCaps2
        offset += 4;
        
        view.setUint32(offset, 0, true); // dwCaps3
        offset += 4;
        
        view.setUint32(offset, 0, true); // dwCaps4
        offset += 4;
        
        view.setUint32(offset, 0, true); // dwReserved2
        offset += 4;
        
        // Теперь пишем данные мипмапов
        let dataOffset = offset;
        currentWidth = alignedWidth;
        currentHeight = alignedHeight;
        
        for (let mip = 0; mip < mipLevels; mip++) {
            const blocksXMip = Math.max(1, Math.ceil(currentWidth / 4));
            const blocksYMip = Math.max(1, Math.ceil(currentHeight / 4));
            
            for (let by = 0; by < blocksYMip; by++) {
                for (let bx = 0; bx < blocksXMip; bx++) {
                    const block = this.encodeDXT5Block(
                        { data: alignedData, width: alignedWidth, height: alignedHeight },
                        alignedWidth,
                        bx * 4,
                        by * 4
                    );
                    
                    for (let i = 0; i < 16; i++) {
                        bytes[dataOffset++] = block[i];
                    }
                }
            }
            
            currentWidth = Math.max(1, currentWidth >> 1);
            currentHeight = Math.max(1, currentHeight >> 1);
        }
        
        return new Uint8Array(ddsBuffer);
    }
    
    /**
     * Загружает PNG файл и конвертирует его в DDS
     */
    async convertFromFile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            
            img.onload = () => {
                // Создаем canvas для получения пикселей
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                // Получаем данные изображения
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                
                // Конвертируем в DDS
                const ddsData = this.convert(imageData);
                
                // Освобождаем память
                URL.revokeObjectURL(url);
                
                resolve({
                    data: ddsData,
                    width: img.width,
                    height: img.height
                });
            };
            
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            
            img.src = url;
        });
    }
}
