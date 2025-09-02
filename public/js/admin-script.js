}

// ==========================================
// STREAMS TABLE & METHODS
// ==========================================
initStreamsTable() {
    if (this.streamsTable) {
        this.streamsTable.destroy();
    }

    this.streamsTable = $('#streamsTable').DataTable({
        processing: true,
        serverSide: true,
        ajax: {
            url: '/admin/api/streams',
            type: 'POST'
        },
        columns: [
            {
                data: 'stream_name',
                render: function (data) {
                    return `<strong>${data}</strong>`;
                }
            },
            {
                data: 'camera',
                render: function (data) {
                    return data ? `${data.name} (${data.brand})` : 'N/A';
                }
            },
            {
                data: 'categories',
                render: function (data) {
                    if (!data || data.length === 0) {
                        return '<small class="text-muted">Kategorisiz</small>';
                    }
                    return data.map(cat =>
                        `<span class="category-badge" style="background-color: ${cat.color}">${cat.name}</span>`
                    ).join(' ');
                }
            },
            { data: 'ip_address' },
            {
                data: 'status',
                render: function (data) {
                    let statusClass = '';
                    let statusText = '';
                    switch (data) {
                        case 'streaming':
                            statusClass = 'status-streaming';
                            statusText = 'Yayın Yapıyor';
                            break;
                        case 'stopped':
                            statusClass = 'status-stopped';
                            statusText = 'Durduruldu';
                            break;
                        case 'starting':
                            statusClass = 'status-starting';
                            statusText = 'Başlatılıyor';
                            break;
                        case 'error':
                            statusClass = 'status-error';
                            statusText = 'Hata';
                            break;
                        default:
                            statusClass = 'status-stopped';
                            statusText = 'Bilinmiyor';
                    }
                    return `<span class="status-badge ${statusClass}">${statusText}</span>`;
                }
            },
            { data: 'resolution' },
            { data: 'fps' },
            {
                data: 'last_started',
                render: function (data) {
                    if (!data) return '<small class="text-muted">Hiç</small>';
                    return new Date(data).toLocaleString('tr-TR');
                }
            },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function (data, type, row) {
                    const isStreaming = row.status === 'streaming' || row.status === 'starting';
                    const startBtn = isStreaming ?
                        `<button class="btn btn-sm btn-outline-danger" onclick="adminPanel.stopStream('${row.id}')" title="Durdur">
                                <i class="fas fa-stop"></i>
                            </button>` :
                        `<button class="btn btn-sm btn-outline-success" onclick="adminPanel.startStream('${row.id}')" title="Başlat">
                                <i class="fas fa-play"></i>
                            </button>`;

                    return `
                            <div class="btn-group" role="group">
                                <button class="btn btn-sm btn-outline-primary" onclick="adminPanel.editStream('${row.id}')" title="Düzenle">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-info" onclick="adminPanel.manageStreamCategories('${row.id}', '${row.stream_name}')" title="Kategorileri Yönet">
                                    <i class="fas fa-tags"></i>
                                </button>
                                ${startBtn}
                                <button class="btn btn-sm btn-outline-danger" onclick="adminPanel.deleteStream('${row.id}', '${row.stream_name}')" title="Sil">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                }
            }
        ],
        order: [[0, 'desc']],
        pageLength: 25,
        responsive: true,
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/tr.json'
        }
    });
}

    async openStreamModal(streamId = null) {
    $('#streamForm')[0].reset();
    $('#streamId').val(streamId || '');

    // Load camera and category lists
    await this.loadCameraList();
    await this.loadCategoryList();

    if (streamId) {
        $('#streamModalTitle').text('Yayın Düzenle');
        $('#streamPasswordHelpText').show();
        $('#stream_password').removeAttr('required');
        await this.loadStreamData(streamId);
    } else {
        $('#streamModalTitle').text('Yeni Yayın Ekle');
        $('#streamPasswordHelpText').hide();
        $('#stream_password').attr('required', true);
    }

    new bootstrap.Modal('#streamModal').show();
}

    async loadCameraList() {
    try {
        const response = await fetch('/admin/api/cameras/list');
        const result = await response.json();

        if (result.success) {
            const cameraSelect = $('#stream_camera');
            cameraSelect.empty().append('<option value="">Kamera Seçin</option>');

            result.data.forEach(camera => {
                cameraSelect.append(`<option value="${camera.id}">${camera.name} - ${camera.brand} ${camera.model}</option>`);
            });
        }
    } catch (error) {
        console.error('Error loading camera list:', error);
    }
}

    async loadCategoryList() {
    try {
        const response = await fetch('/admin/api/categories/list');
        const result = await response.json();

        if (result.success) {
            this.categories = result.data;
            this.renderCategorySelector('#categoriesContainer');
        }
    } catch (error) {
        console.error('Error loading category list:', error);
    }
}

renderCategorySelector(containerSelector) {
    const container = $(containerSelector);
    container.empty();

    this.categories.forEach(category => {
        const iconMap = {
            'camera': '📷', 'video': '🎥', 'broadcast': '📡', 'security': '🔒',
            'outdoor': '🌳', 'indoor': '🏠', 'traffic': '🚗', 'office': '🏢',
            'home': '🏡', 'public': '🏛️', 'sport': '⚽', 'event': '🎪'
        };

        const categoryHtml = `
                <div class="category-option" data-category-id="${category.id}">
                    <input type="checkbox" value="${category.id}" id="cat_${category.id}" name="category_ids[]">
                    <span class="category-icon" style="background-color: ${category.color}"></span>
                    <label for="cat_${category.id}">${iconMap[category.icon] || '📷'} ${category.name}</label>
                </div>
            `;
        container.append(categoryHtml);
    });

    // Add click events
    container.find('.category-option').on('click', function (e) {
        if (e.target.type !== 'checkbox') {
            const checkbox = $(this).find('input[type="checkbox"]');
            checkbox.prop('checked', !checkbox.prop('checked'));
        }

        const checkbox = $(this).find('input[type="checkbox"]');
        if (checkbox.prop('checked')) {
            $(this).addClass('selected');
        } else {
            $(this).removeClass('selected');
        }
    });
}

    async loadStreamData(streamId) {
    try {
        const response = await fetch(`/admin/api/streams/${streamId}`);
        const result = await response.json();

        if (result.success) {
            const stream = result.data;
            $('#stream_name').val(stream.stream_name);
            $('#stream_camera').val(stream.camera_id);
            $('#stream_ip').val(stream.ip_address);
            $('#stream_port').val(stream.rtsp_port);
            $('#stream_channel').val(stream.channel);
            $('#stream_username').val(stream.username);
            $('#stream_resolution').val(stream.resolution);
            $('#stream_fps').val(stream.fps);
            $('#stream_bitrate').val(stream.bitrate);
            $('#stream_audio_bitrate').val(stream.audio_bitrate);
            $('#stream_active').prop('checked', stream.is_active);
            $('#stream_recording').prop('checked', stream.is_recording);

            // Set selected categories
            if (stream.categories && stream.categories.length > 0) {
                const categoryIds = stream.categories.map(cat => cat.id);
                $('#categoriesContainer input[type="checkbox"]').each((index, element) => {
                    const categoryId = $(element).val();
                    const isSelected = categoryIds.includes(categoryId);
                    $(element).prop('checked', isSelected);

                    const option = $(element).closest('.category-option');
                    if (isSelected) {
                        option.addClass('selected');
                    } else {
                        option.removeClass('selected');
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading stream data:', error);
    }
}

    async saveStream() {
    // Get selected categories
    const selectedCategories = [];
    $('#categoriesContainer input[type="checkbox"]:checked').each((index, element) => {
        selectedCategories.push($(element).val());
    });

    // Prepare form data
    const formData = new FormData($('#streamForm')[0]);

    // Add selected categories to form data
    selectedCategories.forEach(categoryId => {
        formData.append('category_ids[]', categoryId);
    });

    const streamId = $('#streamId').val();
    const isEdit = !!streamId;

    try {
        // Save the stream first
        const streamUrl = isEdit ? `/admin/api/streams/${streamId}` : '/admin/api/streams/create';
        const streamMethod = isEdit ? 'PUT' : 'POST';

        const streamResponse = await fetch(streamUrl, {
            method: streamMethod,
            body: formData
        });

        const streamResult = await streamResponse.json();

        if (streamResult.success) {
            // If editing, update categories separately
            if (isEdit) {
                const categoryResponse = await fetch(`/admin/api/streams/${streamId}/categories`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ category_ids: selectedCategories })
                });

                const categoryResult = await categoryResponse.json();
                if (!categoryResult.success) {
                    console.warn('Category update failed:', categoryResult.message);
                }
            }

            Swal.fire({
                title: 'Başarılı!',
                text: streamResult.message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            bootstrap.Modal.getInstance('#streamModal').hide();
            if (this.streamsTable) {
                this.streamsTable.ajax.reload();
            }
        } else {
            Swal.fire({
                title: 'Hata!',
                text: streamResult.message,
                icon: 'error'
            });
        }
    } catch (error) {
        console.error('Error saving stream:', error);
        Swal.fire({
            title: 'Hata!',
            text: 'Yayın kaydedilirken bir hata oluştu.',
            icon: 'error'
        });
    }
}

editStream(streamId) {
    this.openStreamModal(streamId);
}

    // Stream Category Management
    async manageStreamCategories(streamId, streamName) {
    $('#manageStreamId').val(streamId);
    $('#streamCategoriesModalTitle').text(`${streamName} - Kategori Yönetimi`);

    // Load categories and current stream categories
    await this.loadCategoryList();
    await this.loadStreamCategories(streamId);

    new bootstrap.Modal('#streamCategoriesModal').show();
}

    async loadStreamCategories(streamId) {
    try {
        const response = await fetch(`/admin/api/streams/${streamId}/categories`);
        const result = await response.json();

        if (result.success) {
            const streamCategories = result.data.categories || [];
            const categoryIds = streamCategories.map(cat => cat.id);

            // Render categories for modal
            this.renderCategorySelector('#streamCategoriesContainer');

            // Check the appropriate checkboxes
            $('#streamCategoriesContainer input[type="checkbox"]').each((index, element) => {
                const categoryId = $(element).val();
                $(element).prop('checked', categoryIds.includes(categoryId));

                // Update visual state
                const option = $(element).closest('.category-option');
                if (categoryIds.includes(categoryId)) {
                    option.addClass('selected');
                } else {
                    option.removeClass('selected');
                }
            });
        }
    } catch (error) {
        console.error('Error loading stream categories:', error);
    }
}

    async saveStreamCategories() {
    const streamId = $('#manageStreamId').val();
    const selectedCategories = [];

    $('#streamCategoriesContainer input[type="checkbox"]:checked').each((index, element) => {
        selectedCategories.push($(element).val());
    });

    try {
        const response = await fetch(`/admin/api/streams/${streamId}/categories`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ category_ids: selectedCategories })
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({
                title: 'Başarılı!',
                text: result.message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            bootstrap.Modal.getInstance('#streamCategoriesModal').hide();
            if (this.streamsTable) {
                this.streamsTable.ajax.reload();
            }
        } else {
            Swal.fire({
                title: 'Hata!',
                text: result.message,
                icon: 'error'
            });
        }
    } catch (error) {
        console.error('Error saving stream categories:', error);
        Swal.fire({
            title: 'Hata!',
            text: 'Kategoriler kaydedilirken bir hata oluştu.',
            icon: 'error'
        });
    }
}

    async startStream(streamId) {
    try {
        Swal.fire({
            title: 'Yayın Başlatılıyor...',
            text: 'Lütfen bekleyin',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch(`/admin/api/streams/${streamId}/start`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({
                title: 'Başarılı!',
                text: result.message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            this.streamsTable.ajax.reload();
        } else {
            Swal.fire({
                title: 'Hata!',
                text: result.message,
                icon: 'error'
            });
        }
    } catch (error) {
        console.error('Error starting stream:', error);
        Swal.fire({
            title: 'Hata!',
            text: 'Yayın başlatılırken bir hata oluştu.',
            icon: 'error'
        });
    }
}

    async stopStream(streamId) {
    try {
        const response = await fetch(`/admin/api/streams/${streamId}/stop`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({
                title: 'Başarılı!',
                text: result.message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            this.streamsTable.ajax.reload();
        } else {
            Swal.fire({
                title: 'Hata!',
                text: result.message,
                icon: 'error'
            });
        }
    } catch (error) {
        console.error('Error stopping stream:', error);
        Swal.fire({
            title: 'Hata!',
            text: 'Yayın durdurulurken bir hata oluştu.',
            icon: 'error'
        });
    }
}

    async deleteStream(streamId, streamName) {
    const result = await Swal.fire({
        title: 'Emin misiniz?',
        text: `${streamName} yayınını silmek istediğinizden emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Evet, Sil!',
        cancelButtonText: 'İptal'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/admin/api/streams/${streamId}`, {
                method: 'DELETE'
            });

            const deleteResult = await response.json();

            if (deleteResult.success) {
                Swal.fire({
                    title: 'Silindi!',
                    text: 'Yayın başarıyla silindi.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                this.streamsTable.ajax.reload();
            } else {
                Swal.fire({
                    title: 'Hata!',
                    text: deleteResult.message,
                    icon: 'error'
                });
            }
        } catch (error) {
            console.error('Error deleting stream:', error);
            Swal.fire({
                title: 'Hata!',
                text: 'Yayın silinirken bir hata oluştu.',
                icon: 'error'
            });
        }
    }
}
}

// ==========================================
// SLIDER MANAGER CLASS
// ==========================================
class SliderManager {
    constructor() {
        this.sortable = null;
        this.images = [];
        this.init();
    }

    init() {
        this.initEventListeners();
        this.loadSliderImages();
        this.loadSliderStats();
    }

    initEventListeners() {
        // Upload zone events
        $('#uploadZone').on('click', () => {
            $('#imageUpload').click();
        });

        $('#imageUpload').on('change', (e) => {
            this.handleFileSelect(e.target.files);
        });

        // Drag & Drop events
        $('#uploadZone').on('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            $('#uploadZone').addClass('dragover');
        });

        $('#uploadZone').on('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            $('#uploadZone').removeClass('dragover');
        });

        $('#uploadZone').on('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            $('#uploadZone').removeClass('dragover');

            const files = e.originalEvent.dataTransfer.files;
            this.handleFileSelect(files);
        });
    }

    async loadSliderImages() {
        try {
            $('#loading').show();

            const response = await fetch('/admin/api/slider/images');
            const result = await response.json();

            if (result.success) {
                this.images = result.data;
                this.renderSliderImages();
                this.initSortable();
            } else {
                throw new Error(result.message || 'Resimler yüklenemedi');
            }
        } catch (error) {
            console.error('Load images error:', error);
            this.showError('Resimler yüklenirken hata oluştu: ' + error.message);
        } finally {
            $('#loading').hide();
        }
    }

    async loadSliderStats() {
        try {
            const response = await fetch('/admin/api/slider/stats');
            const result = await response.json();

            if (result.success) {
                const stats = result.data;
                $('#totalImages').text(stats.total_images);
                $('#totalSize').text(this.formatFileSize(stats.total_size));
                $('#averageSize').text(this.formatFileSize(stats.average_size));
            }
        } catch (error) {
            console.error('Load stats error:', error);
        }
    }

    renderSliderImages() {
        const $grid = $('#sliderGrid');
        const $empty = $('#emptySlider');

        if (this.images.length === 0) {
            $grid.hide();
            $empty.show();
            return;
        }

        $empty.hide();
        $grid.show();

        const imageHtml = this.images.map((image, index) => `
            <div class="slider-item" data-id="${image.id}">
                <div class="slider-item-order">${index + 1}</div>
                <button class="slider-item-delete" onclick="sliderManager.deleteImage('${image.id}', '${image.original_name}')">
                    <i class="fas fa-times"></i>
                </button>
                <img src="/static/assets/slider/${image.filename}" 
                     alt="${image.original_name}" 
                     onerror="this.src='/static/assets/placeholder.jpg'">
                <div class="slider-item-info">
                    <div class="slider-item-name">${image.original_name}</div>
                    <div class="slider-item-details">
                        ${image.width}×${image.height} • ${this.formatFileSize(image.file_size)}
                    </div>
                </div>
            </div>
        `).join('');

        $grid.html(imageHtml);

        setTimeout(() => {
            this.initSortable();
        }, 100);
    }

    initSortable() {
        if (this.sortable) {
            this.sortable.destroy();
        }

        const gridElement = document.getElementById('sliderGrid');

        if (!gridElement || this.images.length <= 1) {
            return;
        }

        try {
            this.sortable = new Sortable(gridElement, {
                animation: 200,
                ghostClass: 'sortable-ghost',
                onEnd: (evt) => {
                    if (evt.oldIndex !== evt.newIndex) {
                        this.reorderImages(evt.oldIndex, evt.newIndex);
                    }
                }
            });
        } catch (error) {
            console.error('Sortable initialization error:', error);
        }
    }

    async reorderImages(fromIndex, toIndex) {
        try {
            const response = await fetch('/admin/api/slider/reorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fromIndex, toIndex })
            });

            const result = await response.json();

            if (result.success) {
                const [movedItem] = this.images.splice(fromIndex, 1);
                this.images.splice(toIndex, 0, movedItem);
                this.updateOrderNumbers();
                this.showSuccess('Sıralama başarıyla değiştirildi');
            } else {
                throw new Error(result.message || 'Sıralama değiştirilemedi');
            }
        } catch (error) {
            console.error('Reorder error:', error);
            this.showError('Sıralama değiştirilirken hata oluştu: ' + error.message);
            this.loadSliderImages();
        }
    }

    updateOrderNumbers() {
        $('#sliderGrid .slider-item-order').each((index, element) => {
            $(element).text(index + 1);
        });
    }

    async handleFileSelect(files) {
        if (!files || files.length === 0) return;

        const formData = new FormData();
        const validFiles = [];

        for (let file of files) {
            if (this.validateFile(file)) {
                formData.append('images', file);
                validFiles.push(file);
            }
        }

        if (validFiles.length === 0) {
            this.showError('Geçerli resim dosyası seçilmedi');
            return;
        }

        try {
            this.showUploadProgress(true);
            $('#uploadStatus').text(`${validFiles.length} dosya yükleniyor...`);

            const response = await fetch('/admin/api/slider/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccess(`${result.data.uploaded} resim başarıyla yüklendi`);
                await this.loadSliderImages();
                await this.loadSliderStats();
                $('#imageUpload').val('');
            } else {
                throw new Error(result.message || 'Yükleme başarısız');
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showError('Yükleme sırasında hata oluştu: ' + error.message);
        } finally {
            this.showUploadProgress(false);
        }
    }

    validateFile(file) {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            this.showError(`${file.name}: Desteklenmeyen dosya formatı. Sadece JPEG, PNG, WEBP desteklenir.`);
            return false;
        }

        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            this.showError(`${file.name}: Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.`);
            return false;
        }

        return true;
    }

    showUploadProgress(show) {
        if (show) {
            $('.upload-progress').show();
            $('.progress-bar').css('width', '100%').addClass('progress-bar-striped progress-bar-animated');
        } else {
            $('.upload-progress').hide();
            $('.progress-bar').css('width', '0%').removeClass('progress-bar-striped progress-bar-animated');
        }
    }

    async deleteImage(imageId, imageName) {
        const result = await Swal.fire({
            title: 'Emin misiniz?',
            text: `"${imageName}" resmini silmek istediğinizden emin misiniz?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Evet, Sil!',
            cancelButtonText: 'İptal'
        });

        if (result.isConfirmed) {
            try {
                const response = await fetch(`/admin/api/slider/images/${imageId}`, {
                    method: 'DELETE'
                });

                const deleteResult = await response.json();

                if (deleteResult.success) {
                    this.showSuccess('Resim başarıyla silindi');
                    await this.loadSliderImages();
                    await this.loadSliderStats();
                } else {
                    throw new Error(deleteResult.message || 'Silme başarısız');
                }
            } catch (error) {
                console.error('Delete error:', error);
                this.showError('Resim silinirken hata oluştu: ' + error.message);
            }
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    showSuccess(message) {
        Swal.fire({
            title: 'Başarılı!',
            text: message,
            icon: 'success',
            timer: 3000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
        });
    }

    showError(message) {
        Swal.fire({
            title: 'Hata!',
            text: message,
            icon: 'error',
            confirmButtonText: 'Tamam'
        });
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
$(document).ready(function () {
    window.adminPanel = new AdminPanel();
    window.sliderManager = new SliderManager();
});

// Handle page visibility changes to refresh data
document.addEventListener('visibilitychange', function () {
    if (!document.hidden && window.adminPanel) {
        if (window.adminPanel.usersTable && window.adminPanel.currentSection === 'users') {
            window.adminPanel.usersTable.ajax.reload(null, false);
        }
        if (window.adminPanel.categoriesTable && window.adminPanel.currentSection === 'categories') {
            window.adminPanel.categoriesTable.ajax.reload(null, false);
        }
        if (window.adminPanel.camerasTable && window.adminPanel.currentSection === 'cameras') {
            window.adminPanel.camerasTable.ajax.reload(null, false);
        }
        if (window.adminPanel.streamsTable && window.adminPanel.currentSection === 'streams') {
            window.adminPanel.streamsTable.ajax.reload(null, false);
        }
    }
}); class AdminPanel {
    constructor() {
        this.currentSection = 'users';
        this.usersTable = null;
        this.categoriesTable = null;
        this.camerasTable = null;
        this.streamsTable = null;
        this.categories = [];
        this.init();
    }

    init() {
        this.initEventListeners();
        this.initUsersTable();
    }

    initEventListeners() {
        // Sidebar menu items
        $('.menu-item').on('click', (e) => {
            e.preventDefault();
            const section = $(e.currentTarget).data('section');
            this.switchSection(section);
        });

        // User buttons
        $('#addUserBtn').on('click', () => this.openUserModal());
        $('#saveUserBtn').on('click', () => this.saveUser());
        $('#savePasswordBtn').on('click', () => this.changePassword());

        // Category buttons
        $('#addCategoryBtn').on('click', () => this.openCategoryModal());
        $('#saveCategoryBtn').on('click', () => this.saveCategory());
        $('#saveStreamCategoriesBtn').on('click', () => this.saveStreamCategories());

        // Camera buttons
        $('#addCameraBtn').on('click', () => this.openCameraModal());
        $('#saveCameraBtn').on('click', () => this.saveCamera());

        // Stream buttons
        $('#addStreamBtn').on('click', () => this.openStreamModal());
        $('#saveStreamBtn').on('click', () => this.saveStream());

        // Form validation
        $('#confirmPassword').on('input', () => this.validatePasswordMatch());

        // Color picker sync
        $('#category_color').on('input', (e) => {
            $('#category_color_text').val(e.target.value);
        });
        $('#category_color_text').on('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                $('#category_color').val(color);
            }
        });
    }

    switchSection(section) {
        // Update active menu item
        $('.menu-item').removeClass('active');
        $(`.menu-item[data-section="${section}"]`).addClass('active');

        // Hide all sections
        $('.content-section').hide();

        // Show selected section
        $(`#${section}-section`).show();

        this.currentSection = section;

        // Load section data if needed
        if (section === 'users' && !this.usersTable) {
            this.initUsersTable();
        } else if (section === 'categories' && !this.categoriesTable) {
            this.initCategoriesTable();
        } else if (section === 'cameras' && !this.camerasTable) {
            this.initCamerasTable();
        } else if (section === 'streams' && !this.streamsTable) {
            this.initStreamsTable();
        }
    }

    // ==========================================
    // USERS TABLE & METHODS
    // ==========================================
    initUsersTable() {
        if (this.usersTable) {
            this.usersTable.destroy();
        }

        this.usersTable = $('#usersTable').DataTable({
            processing: true,
            serverSide: true,
            ajax: {
                url: '/admin/api/users',
                type: 'POST'
            },
            columns: [
                { data: 'id', width: '50px' },
                {
                    data: 'username',
                    render: function (data) {
                        return `<strong>${data}</strong>`;
                    }
                },
                { data: 'email' },
                {
                    data: 'role',
                    render: function (data) {
                        const roleClass = `role-${data}`;
                        return `<span class="role-badge ${roleClass}">${data.toUpperCase()}</span>`;
                    }
                },
                {
                    data: 'is_active',
                    render: function (data) {
                        const statusClass = data ? 'status-active' : 'status-inactive';
                        const statusText = data ? 'Aktif' : 'Pasif';
                        return `<span class="status-badge ${statusClass}">${statusText}</span>`;
                    }
                },
                {
                    data: 'last_login',
                    render: function (data) {
                        if (!data) return '<small class="text-muted">Hiç giriş yapmamış</small>';
                        return new Date(data).toLocaleString('tr-TR');
                    }
                },
                {
                    data: 'created_at',
                    render: function (data) {
                        return new Date(data).toLocaleString('tr-TR');
                    }
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: function (data, type, row) {
                        return `
                            <div class="btn-group" role="group">
                                <button class="btn btn-sm btn-outline-primary" onclick="adminPanel.editUser('${row.id}')" title="Düzenle">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-warning" onclick="adminPanel.openChangePasswordModal('${row.id}', '${row.username}')" title="Şifre Değiştir">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="adminPanel.deleteUser('${row.id}', '${row.username}')" title="Sil">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                }
            ],
            order: [[0, 'desc']],
            pageLength: 25,
            responsive: true,
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/tr.json'
            }
        });
    }

    openUserModal(userId = null) {
        $('#userForm')[0].reset();
        $('#userId').val(userId || '');

        if (userId) {
            $('#userModalTitle').text('Kullanıcı Düzenle');
            $('#passwordHelpText').show();
            $('#password').removeAttr('required');
            this.loadUserData(userId);
        } else {
            $('#userModalTitle').text('Yeni Kullanıcı Ekle');
            $('#passwordHelpText').hide();
            $('#password').attr('required', true);
        }

        new bootstrap.Modal('#userModal').show();
    }

    async loadUserData(userId) {
        try {
            const response = await fetch(`/admin/api/users/${userId}`);
            const result = await response.json();

            if (result.success) {
                const user = result.data;
                $('#username').val(user.username);
                $('#email').val(user.email);
                $('#role').val(user.role);
                $('#is_active').prop('checked', user.is_active);
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async saveUser() {
        const formData = new FormData($('#userForm')[0]);
        const userId = $('#userId').val();
        const isEdit = !!userId;

        const url = isEdit ? `/admin/api/users/${userId}` : '/admin/api/users/create';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                Swal.fire({
                    title: 'Başarılı!',
                    text: result.message,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                bootstrap.Modal.getInstance('#userModal').hide();
                this.usersTable.ajax.reload();
            } else {
                Swal.fire({
                    title: 'Hata!',
                    text: result.message,
                    icon: 'error'
                });
            }
        } catch (error) {
            console.error('Error saving user:', error);
            Swal.fire({
                title: 'Hata!',
                text: 'Kullanıcı kaydedilirken bir hata oluştu.',
                icon: 'error'
            });
        }
    }

    editUser(userId) {
        this.openUserModal(userId);
    }

    openChangePasswordModal(userId, username) {
        $('#changePasswordForm')[0].reset();
        $('#changePasswordUserId').val(userId);
        $('#changePasswordModal .modal-title').text(`${username} - Şifre Değiştir`);

        new bootstrap.Modal('#changePasswordModal').show();
    }

    async changePassword() {
        const newPassword = $('#newPassword').val();
        const confirmPassword = $('#confirmPassword').val();
        const userId = $('#changePasswordUserId').val();

        if (newPassword !== confirmPassword) {
            Swal.fire({
                title: 'Hata!',
                text: 'Şifreler eşleşmiyor!',
                icon: 'error'
            });
            return;
        }

        if (newPassword.length < 6) {
            Swal.fire({
                title: 'Hata!',
                text: 'Şifre en az 6 karakter olmalıdır!',
                icon: 'error'
            });
            return;
        }

        try {
            const response = await fetch(`/admin/api/users/${userId}/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password: newPassword })
            });

            const result = await response.json();

            if (result.success) {
                Swal.fire({
                    title: 'Başarılı!',
                    text: 'Şifre başarıyla değiştirildi.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                bootstrap.Modal.getInstance('#changePasswordModal').hide();
            } else {
                Swal.fire({
                    title: 'Hata!',
                    text: result.message,
                    icon: 'error'
                });
            }
        } catch (error) {
            console.error('Error changing password:', error);
            Swal.fire({
                title: 'Hata!',
                text: 'Şifre değiştirilirken bir hata oluştu.',
                icon: 'error'
            });
        }
    }

    async deleteUser(userId, username) {
        const result = await Swal.fire({
            title: 'Emin misiniz?',
            text: `${username} kullanıcısını silmek istediğinizden emin misiniz?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Evet, Sil!',
            cancelButtonText: 'İptal'
        });

        if (result.isConfirmed) {
            try {
                const response = await fetch(`/admin/api/users/${userId}`, {
                    method: 'DELETE'
                });

                const deleteResult = await response.json();

                if (deleteResult.success) {
                    Swal.fire({
                        title: 'Silindi!',
                        text: 'Kullanıcı başarıyla silindi.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    this.usersTable.ajax.reload();
                } else {
                    Swal.fire({
                        title: 'Hata!',
                        text: deleteResult.message,
                        icon: 'error'
                    });
                }
            } catch (error) {
                console.error('Error deleting user:', error);
                Swal.fire({
                    title: 'Hata!',
                    text: 'Kullanıcı silinirken bir hata oluştu.',
                    icon: 'error'
                });
            }
        }
    }

    validatePasswordMatch() {
        const newPassword = $('#newPassword').val();
        const confirmPassword = $('#confirmPassword').val();

        if (confirmPassword && newPassword !== confirmPassword) {
            $('#confirmPassword')[0].setCustomValidity('Şifreler eşleşmiyor');
        } else {
            $('#confirmPassword')[0].setCustomValidity('');
        }
    }

    // ==========================================
    // CATEGORIES TABLE & METHODS
    // ==========================================
    initCategoriesTable() {
        if (this.categoriesTable) {
            this.categoriesTable.destroy();
        }

        this.categoriesTable = $('#categoriesTable').DataTable({
            processing: true,
            serverSide: true,
            ajax: {
                url: '/admin/api/categories',
                type: 'POST'
            },
            columns: [
                {
                    data: 'name',
                    render: function (data) {
                        return `<strong>${data}</strong>`;
                    }
                },
                {
                    data: 'color',
                    render: function (data) {
                        return `<div class="category-color-preview" style="background-color: ${data}"></div><code>${data}</code>`;
                    }
                },
                {
                    data: 'icon',
                    render: function (data) {
                        const iconMap = {
                            'camera': '📷', 'video': '🎥', 'broadcast': '📡', 'security': '🔒',
                            'outdoor': '🌳', 'indoor': '🏠', 'traffic': '🚗', 'office': '🏢',
                            'home': '🏡', 'public': '🏛️', 'sport': '⚽', 'event': '🎪'
                        };
                        return `${iconMap[data] || '📷'} ${data}`;
                    }
                },
                { data: 'sort_order' },
                {
                    data: null,
                    render: function (data, type, row) {
                        const streamCount = row.stream_count || 0;
                        return `<span class="badge bg-primary">${streamCount}</span>`;
                    }
                },
                {
                    data: 'is_active',
                    render: function (data) {
                        const statusClass = data ? 'status-active' : 'status-inactive';
                        const statusText = data ? 'Aktif' : 'Pasif';
                        return `<span class="status-badge ${statusClass}">${statusText}</span>`;
                    }
                },
                {
                    data: 'created_at',
                    render: function (data) {
                        return new Date(data).toLocaleString('tr-TR');
                    }
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: function (data, type, row) {
                        return `
                            <div class="btn-group" role="group">
                                <button class="btn btn-sm btn-outline-primary" onclick="adminPanel.editCategory('${row.id}')" title="Düzenle">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="adminPanel.deleteCategory('${row.id}', '${row.name}')" title="Sil">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                }
            ],
            order: [[3, 'asc']], // Sort by sort_order
            pageLength: 25,
            responsive: true,
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/tr.json'
            }
        });
    }

    openCategoryModal(categoryId = null) {
        $('#categoryForm')[0].reset();
        $('#categoryId').val(categoryId || '');

        if (categoryId) {
            $('#categoryModalTitle').text('Kategori Düzenle');
            this.loadCategoryData(categoryId);
        } else {
            $('#categoryModalTitle').text('Yeni Kategori Ekle');
            $('#category_color').val('#007bff');
            $('#category_color_text').val('#007bff');
        }

        new bootstrap.Modal('#categoryModal').show();
    }

    async loadCategoryData(categoryId) {
        try {
            const response = await fetch(`/admin/api/categories/${categoryId}`);
            const result = await response.json();

            if (result.success) {
                const category = result.data;
                $('#category_name').val(category.name);
                $('#category_description').val(category.description);
                $('#category_color').val(category.color);
                $('#category_color_text').val(category.color);
                $('#category_icon').val(category.icon);
                $('#category_sort_order').val(category.sort_order);
                $('#category_active').prop('checked', category.is_active);
            }
        } catch (error) {
            console.error('Error loading category data:', error);
        }
    }

    async saveCategory() {
        const formData = new FormData($('#categoryForm')[0]);
        const categoryId = $('#categoryId').val();
        const isEdit = !!categoryId;

        const url = isEdit ? `/admin/api/categories/${categoryId}` : '/admin/api/categories/create';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                Swal.fire({
                    title: 'Başarılı!',
                    text: result.message,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                bootstrap.Modal.getInstance('#categoryModal').hide();
                if (this.categoriesTable) {
                    this.categoriesTable.ajax.reload();
                }
            } else {
                Swal.fire({
                    title: 'Hata!',
                    text: result.message,
                    icon: 'error'
                });
            }
        } catch (error) {
            console.error('Error saving category:', error);
            Swal.fire({
                title: 'Hata!',
                text: 'Kategori kaydedilirken bir hata oluştu.',
                icon: 'error'
            });
        }
    }

    editCategory(categoryId) {
        this.openCategoryModal(categoryId);
    }

    async deleteCategory(categoryId, categoryName) {
        const result = await Swal.fire({
            title: 'Emin misiniz?',
            text: `${categoryName} kategorisini silmek istediğinizden emin misiniz?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Evet, Sil!',
            cancelButtonText: 'İptal'
        });

        if (result.isConfirmed) {
            try {
                const response = await fetch(`/admin/api/categories/${categoryId}`, {
                    method: 'DELETE'
                });

                const deleteResult = await response.json();

                if (deleteResult.success) {
                    Swal.fire({
                        title: 'Silindi!',
                        text: 'Kategori başarıyla silindi.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    this.categoriesTable.ajax.reload();
                } else {
                    // Force delete confirmation
                    if (deleteResult.data && deleteResult.data.forceDeleteUrl) {
                        const forceResult = await Swal.fire({
                            title: 'Zorla Sil?',
                            text: deleteResult.message + ' Zorla silmek istiyorsanız, kategorideki tüm yayınlar kategorisiz kalacak.',
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#d33',
                            cancelButtonColor: '#3085d6',
                            confirmButtonText: 'Zorla Sil!',
                            cancelButtonText: 'İptal'
                        });

                        if (forceResult.isConfirmed) {
                            const forceResponse = await fetch(`/admin/api/categories/${categoryId}?force=true`, {
                                method: 'DELETE'
                            });

                            const forceDeleteResult = await forceResponse.json();

                            if (forceDeleteResult.success) {
                                Swal.fire({
                                    title: 'Silindi!',
                                    text: `Kategori silindi. ${forceDeleteResult.data.removedRelations} yayın kategorisiz kaldı.`,
                                    icon: 'success',
                                    timer: 3000,
                                    showConfirmButton: false
                                });

                                this.categoriesTable.ajax.reload();
                                if (this.streamsTable) {
                                    this.streamsTable.ajax.reload();
                                }
                            } else {
                                throw new Error(forceDeleteResult.message);
                            }
                        }
                    } else {
                        Swal.fire({
                            title: 'Hata!',
                            text: deleteResult.message,
                            icon: 'error'
                        });
                    }
                }
            } catch (error) {
                console.error('Error deleting category:', error);
                Swal.fire({
                    title: 'Hata!',
                    text: 'Kategori silinirken bir hata oluştu.',
                    icon: 'error'
                });
            }
        }
    }

    // ==========================================
    // CAMERAS TABLE & METHODS
    // ==========================================
    initCamerasTable() {
        if (this.camerasTable) {
            this.camerasTable.destroy();
        }

        this.camerasTable = $('#camerasTable').DataTable({
            processing: true,
            serverSide: true,
            ajax: {
                url: '/admin/api/cameras',
                type: 'POST'
            },
            columns: [
                {
                    data: 'name',
                    render: function (data) {
                        return `<strong>${data}</strong>`;
                    }
                },
                { data: 'brand' },
                { data: 'model' },
                {
                    data: 'is_active',
                    render: function (data) {
                        const statusClass = data ? 'status-active' : 'status-inactive';
                        const statusText = data ? 'Aktif' : 'Pasif';
                        return `<span class="status-badge ${statusClass}">${statusText}</span>`;
                    }
                },
                {
                    data: 'streams',
                    render: function (data) {
                        return data ? data.length : 0;
                    }
                },
                {
                    data: 'created_at',
                    render: function (data) {
                        return new Date(data).toLocaleString('tr-TR');
                    }
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: function (data, type, row) {
                        return `
                            <div class="btn-group" role="group">
                                <button class="btn btn-sm btn-outline-primary" onclick="adminPanel.editCamera('${row.id}')" title="Düzenle">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="adminPanel.deleteCamera('${row.id}', '${row.name}')" title="Sil">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                }
            ],
            order: [[0, 'desc']],
            pageLength: 25,
            responsive: true,
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/tr.json'
            }
        });
    }

    openCameraModal(cameraId = null) {
        $('#cameraForm')[0].reset();
        $('#cameraId').val(cameraId || '');

        if (cameraId) {
            $('#cameraModalTitle').text('Kamera Düzenle');
            this.loadCameraData(cameraId);
        } else {
            $('#cameraModalTitle').text('Yeni Kamera Ekle');
        }

        new bootstrap.Modal('#cameraModal').show();
    }

    async loadCameraData(cameraId) {
        try {
            const response = await fetch(`/admin/api/cameras/${cameraId}`);
            const result = await response.json();

            if (result.success) {
                const camera = result.data;
                $('#camera_name').val(camera.name);
                $('#camera_brand').val(camera.brand);
                $('#camera_model').val(camera.model);
                $('#camera_description').val(camera.description);
                $('#camera_active').prop('checked', camera.is_active);
            }
        } catch (error) {
            console.error('Error loading camera data:', error);
        }
    }

    async saveCamera() {
        const formData = new FormData($('#cameraForm')[0]);
        const cameraId = $('#cameraId').val();
        const isEdit = !!cameraId;

        const url = isEdit ? `/admin/api/cameras/${cameraId}` : '/admin/api/cameras/create';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                Swal.fire({
                    title: 'Başarılı!',
                    text: result.message,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                bootstrap.Modal.getInstance('#cameraModal').hide();
                if (this.camerasTable) {
                    this.camerasTable.ajax.reload();
                }
            } else {
                Swal.fire({
                    title: 'Hata!',
                    text: result.message,
                    icon: 'error'
                });
            }
        } catch (error) {
            console.error('Error saving camera:', error);
            Swal.fire({
                title: 'Hata!',
                text: 'Kamera kaydedilirken bir hata oluştu.',
                icon: 'error'
            });
        }
    }

    editCamera(cameraId) {
        this.openCameraModal(cameraId);
    }

    async deleteCamera(cameraId, cameraName) {
        const result = await Swal.fire({
            title: 'Emin misiniz?',
            text: `${cameraName} kamerasını silmek istediğinizden emin misiniz?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Evet, Sil!',
            cancelButtonText: 'İptal'
        });

        if (result.isConfirmed) {
            try {
                const response = await fetch(`/admin/api/cameras/${cameraId}`, {
                    method: 'DELETE'
                });

                const deleteResult = await response.json();

                if (deleteResult.success) {
                    Swal.fire({
                        title: 'Silindi!',
                        text: 'Kamera başarıyla silindi.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    this.camerasTable.ajax.reload();
                } else {
                    Swal.fire({
                        title: 'Hata!',
                        text: deleteResult.message,
                        icon: 'error'
                    });
                }
            } catch (error) {
                console.error('Error deleting camera:', error);
                Swal.fire({
                    title: 'Hata!',
                    text: 'Kamera silinirken bir hata oluştu.',
                    icon: 'error'
                });
            }
        }
    }