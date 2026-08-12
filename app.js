/**
 * Основное приложение для конвертации PNG → DDS → YTD
 */

// Глобальные переменные
let selectedFile = null;
let ddsResult = null;

// DOM элементы
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const previewContainer = document.getElementById('previewContainer');
const originalPreview = document.getElementById('originalPreview');
const ddsPreview = document.getElementById('ddsPreview');
const pngInfo = document.getElementById('pngInfo');
const ddsInfo = document.getElementById('ddsInfo');
const convertBtn = document.getElementById('convertBtn');
const statusDiv = document.getElementById('status');

// Инициализация конвертеров
const pngToDdsConverter = new PngToDdsConverter();
const ddsToYtdConverter = new DdsToYtdConverter();

// Обработчики drag & drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'image/png') {
        handleFileSelect(files[0]);
    } else {
        showStatus('Пожалуйста, выберите PNG файл', 'error');
    }
});

// Обработчик выбора файла через input
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

// Обработка выбранного файла
function handleFileSelect(file) {
    if (file.type !== 'image/png') {
        showStatus('Пожалуйста, выберите PNG файл', 'error');
        return;
    }
    
    selectedFile = file;
    fileNameDisplay.textContent = `Выбран файл: ${file.name}`;
    
    // Показываем превью оригинального изображения
    const url = URL.createObjectURL(file);
    originalPreview.src = url;
    originalPreview.onload = () => {
        URL.revokeObjectURL(url);
        pngInfo.textContent = `${originalPreview.naturalWidth} x ${originalPreview.naturalHeight}px`;
    };
    
    previewContainer.style.display = 'flex';
    convertBtn.disabled = false;
    ddsPreview.src = '';
    ddsInfo.textContent = '';
    hideStatus();
}

// Запуск конвертации
async function startConversion() {
    if (!selectedFile) {
        showStatus('Сначала выберите PNG файл', 'error');
        return;
    }
    
    convertBtn.disabled = true;
    showStatus('Конвертация PNG в DDS...', 'processing');
    
    try {
        // Шаг 1: Конвертация PNG в DDS
        const ddsResult = await pngToDdsConverter.convertFromFile(selectedFile);
        
        // Показываем превью DDS (создаем canvas из данных)
        showDdsPreview(ddsResult.data, ddsResult.width, ddsResult.height);
        
        showStatus('DDS создан! Теперь создаем YTD...', 'processing');
        
        // Небольшая задержка для обновления UI
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Шаг 2: Конвертация DDS в YTD
        const textureName = selectedFile.name.replace('.png', '');
        const ytdData = ddsToYtdConverter.convert(ddsResult.data, textureName);
        
        showStatus('Готово! Скачивание файлов...', 'success');
        
        // Шаг 3: Скачивание результатов
        await downloadFile(ddsResult.data, `${textureName}.dds`);
        await new Promise(resolve => setTimeout(resolve, 500));
        await downloadFile(ytdData, `${textureName}.ytd`);
        
        showStatus('✅ Файлы успешно сконвертированы и скачаны!', 'success');
        convertBtn.disabled = false;
        
    } catch (error) {
        console.error('Ошибка конвертации:', error);
        showStatus(`Ошибка: ${error.message}`, 'error');
        convertBtn.disabled = false;
    }
}

// Показ превью DDS
function showDdsPreview(ddsData, width, height) {
    // Создаем canvas для отображения превью
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, 256);
    canvas.height = Math.min(height, 256);
    const ctx = canvas.getContext('2d');
    
    // Для превью просто показываем оригинальное изображение с пометкой
    // (декомпрессия DXT5 в браузере сложна, используем упрощенное превью)
    const img = new Image();
    img.src = originalPreview.src;
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Добавляем полупрозрачный оверлей "DXT5"
        ctx.fillStyle = 'rgba(0, 217, 255, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#00d9ff';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('DXT5', canvas.width / 2, canvas.height / 2);
        
        ddsPreview.src = canvas.toDataURL();
        ddsInfo.textContent = `${width} x ${height}px (DXT5)`;
    };
}

// Скачивание файла
function downloadFile(data, filename) {
    return new Promise((resolve) => {
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Небольшая задержка перед разрешением
        setTimeout(resolve, 100);
    });
}

// Показ статуса
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

// Скрытие статуса
function hideStatus() {
    statusDiv.style.display = 'none';
    statusDiv.className = 'status';
}
