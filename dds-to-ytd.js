/**
 * DdsToYtdConverter - Конвертирует DDS файл в YTD (Texture Dictionary) формат
 * Основано на структуре YTD из CodeWalker и Folder2YTD
 */
class DdsToYtdConverter {
    constructor() {
        // Константы из CodeWalker
        this.YTD_BLOCK_LENGTH = 64;
        
        // Ресурс константы
        this.RESOURCE_FLAG_NULL = 0x00000000;
        this.RESOURCE_FLAG_PHYSICAL = 0x00000001;
        
        // Texture format константы (из CodeWalker Texture.cs)
        this.TEXTURE_FORMAT_DXT5 = 0x06; // D3DFMT_DXT5
        
        // Размерности блоков
        this.POINTER_SIZE = 8; // 64-bit pointers
        this.UINT_SIZE = 4;
    }
    
    /**
     * Вычисляет хеш Jenkins для имени текстуры
     * Упрощенная версия JenkHash.GenHash из CodeWalker
     */
    jenkinsHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) + hash) + char;
            hash = hash & hash; // Convert to 32bit integer
            hash = hash >>> 0;
        }
        return hash >>> 0;
    }
    
    /**
     * Парсит DDS заголовок для получения информации о текстуре
     */
    parseDdsHeader(ddsData) {
        const view = new DataView(ddsData.buffer, ddsData.byteOffset, ddsData.byteLength);
        let offset = 0;
        
        // Проверка magic number
        const magic = view.getUint32(offset, true);
        if (magic !== 0x20534444) {
            throw new Error('Invalid DDS file');
        }
        offset += 4;
        
        // Читаем основной заголовок
        const headerSize = view.getUint32(offset, true);
        offset += 4;
        
        const flags = view.getUint32(offset, true);
        offset += 4;
        
        const height = view.getUint32(offset, true);
        offset += 4;
        
        const width = view.getUint32(offset, true);
        offset += 4;
        
        const pitchOrLinearSize = view.getUint32(offset, true);
        offset += 4;
        
        const depth = view.getUint32(offset, true);
        offset += 4;
        
        const mipMapCount = view.getUint32(offset, true);
        offset += 4;
        
        // Пропускаем зарезервированные байты (44 байта)
        offset += 44;
        
        // Pixel format
        const pfSize = view.getUint32(offset, true);
        offset += 4;
        
        const pfFlags = view.getUint32(offset, true);
        offset += 4;
        
        const fourCC = view.getUint32(offset, true);
        offset += 4;
        
        return {
            width,
            height,
            mipMapCount,
            fourCC,
            dataSize: ddsData.byteLength - 128 // 4 (magic) + 124 (header)
        };
    }
    
    /**
     * Создает YTD файл из DDS данных
     */
    convert(ddsData, textureName) {
        // Парсим DDS для получения информации
        const ddsInfo = this.parseDdsHeader(ddsData);
        
        // Нормализуем имя текстуры
        const name = textureName.toLowerCase();
        const nameHash = this.jenkinsHash(name);
        
        // Создаем структуру YTD
        // Структура TextureDictionary из CodeWalker:
        // - 16 байт базового заголовка ResourceFileBase
        // - 4 байта Unknown_10h
        // - 4 байта Unknown_14h  
        // - 4 байта Unknown_18h (обычно 1)
        // - 4 байта Unknown_1Ch
        // - ResourceSimpleList64_uint для TextureNameHashes (16 байт заголовок + данные)
        // - ResourcePointerList64<Texture> для Textures (16 байт заголовок + данные)
        
        // Сначала вычисляем размеры всех компонентов
        const nameBytes = new TextEncoder().encode(name);
        const namePaddedLength = Math.ceil((nameBytes.length + 1) / 4) * 4; // Выравнивание по 4
        
        // Размер данных текстуры
        const textureDataSize = ddsInfo.dataSize;
        
        // Вычисляем смещения
        // Базовая структура YTD
        const baseHeaderSize = 16; // ResourceFileBase
        const dictFixedFields = 16; // 4 uint32: Unknown_10h, 14h, 18h, 1Ch
        
        // Списки
        const nameHashListHeaderSize = 16; // ResourceSimpleList64: pointer (8) + count (4) + capacity (4)
        const nameHashListDataSize = 4; // Один хеш имени
        
        const textureListHeaderSize = 16; // ResourcePointerList64: pointer (8) + count (4) + capacity (4)
        const textureListDataSize = 8; // Один pointer на текстуру
        
        // Данные имени текстуры
        const nameDataSize = namePaddedLength;
        
        // Заголовок текстуры (структура Texture)
        // Из CodeWalker Texture.cs:
        // - 16 байт ResourceFileBase
        // - 4 байта Unknown_10h
        // - 4 байта Format
        // - 4 байта Usage
        // - 4 байта Width
        // - 4 байта Height
        // - 4 байта Depth
        // - 4 байта MipMapLevels
        // - 4 байта VertexBufferLayout
        // - 8 байт Name (pointer или inline для коротких имен)
        // - 8 байт Data (pointer)
        // - 4 байта MemoryUsage
        // - 4 байта Reserved
        const textureHeaderSize = 64;
        
        // Вычисляем общее смещение для данных DDS с выравниванием по 8 байт
        const ytdHeaderSize = baseHeaderSize + dictFixedFields + 
                              nameHashListHeaderSize + nameHashListDataSize +
                              textureListHeaderSize + textureListDataSize;
        
        // Выравниваем все смещения по 8 байт для корректной работы pointers
        const nameDataOffset = Math.ceil(ytdHeaderSize / 8) * 8;
        const textureHeaderOffset = Math.ceil((nameDataOffset + namePaddedLength) / 8) * 8;
        const ddsDataOffset = Math.ceil((textureHeaderOffset + textureHeaderSize) / 8) * 8;
        
        // Общий размер
        const totalSize = ddsDataOffset + textureDataSize;
        
        // Создаем буфер
        const ytdBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(ytdBuffer);
        const bytes = new Uint8Array(ytdBuffer);
        
        let offset = 0;
        
        // === ResourceFileBase (16 байт) ===
        // VTable pointer (8 байт) - обычно 0 для файлов
        view.setBigUint64(offset, 0n, true);
        offset += 8;
        
        // BlockLength (8 байт)
        view.setBigUint64(offset, BigInt(this.YTD_BLOCK_LENGTH), true);
        offset += 8;
        
        // === Fixed fields TextureDictionary ===
        view.setUint32(offset, 0x00000000, true); // Unknown_10h
        offset += 4;
        
        view.setUint32(offset, 0x00000000, true); // Unknown_14h
        offset += 4;
        
        view.setUint32(offset, 0x00000001, true); // Unknown_18h
        offset += 4;
        
        view.setUint32(offset, 0x00000000, true); // Unknown_1Ch
        offset += 4;
        
        // === ResourceSimpleList64_uint для TextureNameHashes ===
        // Pointer к данным (смещение от начала файла / 8)
        // Выравниваем nameDataOffset по 8 байт
        const alignedNameDataOffset = Math.ceil(nameDataOffset / 8) * 8;
        const nameHashListPtr = alignedNameDataOffset / 8;
        view.setBigUint64(offset, BigInt(nameHashListPtr), true);
        offset += 8;
        
        // Count
        view.setUint32(offset, 1, true);
        offset += 4;
        
        // Capacity
        view.setUint32(offset, 1, true);
        offset += 4;
        
        // Данные списка хешей имен (4 байта)
        view.setUint32(offset, nameHash, true);
        offset += 4;
        
        // === ResourcePointerList64<Texture> для Textures ===
        // Pointer к данным (смещение от начала файла / 8)
        const alignedTextureHeaderOffset = Math.ceil(textureHeaderOffset / 8) * 8;
        const textureListPtr = alignedTextureHeaderOffset / 8;
        view.setBigUint64(offset, BigInt(textureListPtr), true);
        offset += 8;
        
        // Count
        view.setUint32(offset, 1, true);
        offset += 4;
        
        // Capacity
        view.setUint32(offset, 1, true);
        offset += 4;
        
        // Pointer на текстуру (смещение от начала файла / 8)
        view.setBigUint64(offset, BigInt(alignedTextureHeaderOffset / 8), true);
        offset += 8;
        
        // === Имя текстуры ===
        for (let i = 0; i < nameBytes.length; i++) {
            bytes[offset++] = nameBytes[i];
        }
        // Padding до выравнивания 4
        while (offset % 4 !== 0) {
            bytes[offset++] = 0;
        }
        // Дополнительное padding для выравнивания по 8
        while (offset % 8 !== 0) {
            bytes[offset++] = 0;
        }
        
        // === Заголовок текстуры (Texture) ===
        const textureStartOffset = offset;
        
        // ResourceFileBase для Texture
        view.setBigUint64(offset, 0n, true); // VTable
        offset += 8;
        
        // BlockLength - вычисляем как смещение до DDS данных минус начало текстуры
        const alignedDdsDataOffset = Math.ceil((textureStartOffset + textureHeaderSize) / 8) * 8;
        view.setBigUint64(offset, BigInt(alignedDdsDataOffset - textureStartOffset), true);
        offset += 8;
        
        // Unknown_10h
        view.setUint32(offset, 0x00000000, true);
        offset += 4;
        
        // Format (DXT5 = 0x06)
        view.setUint32(offset, this.TEXTURE_FORMAT_DXT5, true);
        offset += 4;
        
        // Usage
        view.setUint32(offset, 0x00000000, true);
        offset += 4;
        
        // Width
        view.setUint32(offset, ddsInfo.width, true);
        offset += 4;
        
        // Height
        view.setUint32(offset, ddsInfo.height, true);
        offset += 4;
        
        // Depth
        view.setUint32(offset, 1, true);
        offset += 4;
        
        // MipMapLevels
        view.setUint32(offset, ddsInfo.mipMapCount, true);
        offset += 4;
        
        // VertexBufferLayout
        view.setUint32(offset, 0x00000000, true);
        offset += 4;
        
        // Name pointer (inline для коротких имен, используем pointer)
        const namePtr = alignedNameDataOffset / 8;
        view.setBigUint64(offset, BigInt(namePtr), true);
        offset += 8;
        
        // Data pointer (смещение к DDS данным / 8)
        const dataPtr = alignedDdsDataOffset / 8;
        view.setBigUint64(offset, BigInt(dataPtr), true);
        offset += 8;
        
        // MemoryUsage
        view.setUint32(offset, textureDataSize, true);
        offset += 4;
        
        // Reserved
        view.setUint32(offset, 0x00000000, true);
        offset += 4;
        
        // Выравниваем offset по 8 перед записью DDS данных
        while (offset % 8 !== 0) {
            bytes[offset++] = 0;
        }
        
        // === DDS данные ===
        // Копируем DDS данные (пропуская 128 байт заголовка DDS, так как мы храним только pixel data)
        // Но на самом деле для YTD нужны полные DDS данные включая заголовок
        for (let i = 0; i < ddsData.byteLength; i++) {
            bytes[offset++] = ddsData[i];
        }
        
        return new Uint8Array(ytdBuffer);
    }
    
    /**
     * Конвертирует DDS файл в YTD
     */
    async convertFromFile(ddsFile, textureName) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const ddsData = new Uint8Array(e.target.result);
                    const ytdData = this.convert(ddsData, textureName);
                    resolve(ytdData);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read DDS file'));
            };
            
            reader.readAsArrayBuffer(ddsFile);
        });
    }
}
