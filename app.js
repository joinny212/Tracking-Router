// Khởi tạo bản đồ
const map = L.map('map').setView([10.7769, 106.7009], 13);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
}).addTo(map);

let allData = [];
let markersLayer = L.layerGroup().addTo(map);
let polylineLayer = L.layerGroup().addTo(map);
const canvasRenderer = L.canvas({ padding: 0.5 });
let currentMapData = allData;
let mapRenderVersion = 0;
let routeReadIndex = 0;
let routeReadVisits = [];
let routeReadActive = false;

// Dữ liệu mặc định ban đầu
const defaultData = [
    { "STT": 1, "Mã NVBH": "NV01", "Tên NVBH": "Nguyễn Văn A", "Tên Khách Hàng / Điểm Bán": "Tạp hóa Cô Ba", "Vĩ Độ (Lat)": 10.8351, "Kinh Độ (Lng)": 106.6645, "Giờ Check-in": "08:30", "Giờ Check-out": "08:45", "Trạng Thái": "Đạt", "Ghi Chú Viếng Thăm": "Đã trưng bày kệ mới" },
    { "STT": 2, "Mã NVBH": "NV01", "Tên NVBH": "Nguyễn Văn A", "Tên Khách Hàng / Điểm Bán": "Đại lý Minh Phát", "Vĩ Độ (Lat)": 10.8231, "Kinh Độ (Lng)": 106.6296, "Giờ Check-in": "09:15", "Giờ Check-out": "09:35", "Trạng Thái": "Đạt", "Ghi Chú Viếng Thăm": "Nhập thêm 10 thùng hàng" },
    { "STT": 3, "Mã NVBH": "NV01", "Tên NVBH": "Nguyễn Văn A", "Tên Khách Hàng / Điểm Bán": "Cửa hàng Tiện Lợi", "Vĩ Độ (Lat)": 10.7951, "Kinh Độ (Lng)": 106.6745, "Giờ Check-in": "10:30", "Giờ Check-out": "10:40", "Trạng Thái": "Không đạt", "Ghi Chú Viếng Thăm": "Chủ cửa hàng đi vắng" }
];

allData = defaultData;
loadDataToMap(allData);
updateSelectOptions(allData);

function normalizeHeader(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function parseGpsCoordinates(value) {
    if (!value) return null;

    const coordinates = String(value).match(/-?\d+(?:\.\d+)?/g);
    if (!coordinates || coordinates.length < 2) return null;

    const lat = Number(coordinates[0]);
    const lng = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return null;
    }

    return [lat, lng];
}

function parseCoordinate(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const text = String(value ?? '').trim();
    if (!text) return null;

    const coordinate = Number(text.includes(',') && !text.includes('.')
        ? text.replace(',', '.')
        : text);
    return Number.isFinite(coordinate) ? coordinate : null;
}

function getVisitCoordinates(item) {
    const latitude = parseCoordinate(item["Vĩ Độ (Lat)"]);
    const longitude = parseCoordinate(item["Kinh Độ (Lng)"]);
    const legacyCoordinates = latitude !== null && longitude !== null
        ? [latitude, longitude]
        : null;
    const coordinates = parseGpsCoordinates(item["GPS Check-in"]) ||
        parseGpsCoordinates(item["GPS Check-out"]) ||
        legacyCoordinates;

    return coordinates && Math.abs(coordinates[0]) <= 90 &&
        Math.abs(coordinates[1]) <= 180
        ? coordinates
        : null;
}

function parseVisitTime(value) {
    const match = String(value ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    const meridiem = match[4]?.toUpperCase();

    if (hours > 23 || minutes > 59 || seconds > 59 ||
        (meridiem && (hours < 1 || hours > 12))) {
        return null;
    }

    if (meridiem) {
        hours = (hours % 12) + (meridiem === 'PM' ? 12 : 0);
    }

    return hours * 3600 + minutes * 60 + seconds;
}

function stopRouteReading() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    routeReadActive = false;
    routeReadVisits = [];
    routeReadIndex = 0;
    const button = document.getElementById('readRouteButton');
    const status = document.getElementById('readRouteStatus');
    if (button) button.textContent = 'Đọc lộ trình';
    if (status) status.textContent = '';
}

function speakNextRouteVisit() {
    if (!routeReadActive || routeReadIndex >= routeReadVisits.length) {
        routeReadActive = false;
        document.getElementById('readRouteButton').textContent = 'Đọc lộ trình';
        document.getElementById('readRouteStatus').textContent = 'Đã đọc xong lộ trình.';
        return;
    }

    const { item, visitNumber } = routeReadVisits[routeReadIndex];
    const customerName = item["Tên Khách Hàng"] ||
        item["Tên Khách Hàng / Điểm Bán"] || 'Khách hàng';
    const checkIn = item["Check-in"] || item["Giờ Check-in"];
    const address = item["Địa Chỉ KH"];
    const parts = [
        `Điểm ${visitNumber}: ${customerName}.`,
        checkIn && `Giờ viếng thăm ${checkIn}.`,
        address && `Địa chỉ ${address}.`,
        isOffRoute(item) && 'Điểm ngoài tuyến.'
    ].filter(Boolean);
    const utterance = new SpeechSynthesisUtterance(parts.join(' '));
    utterance.lang = 'vi-VN';
    utterance.onend = () => {
        if (!routeReadActive) return;
        routeReadIndex++;
        speakNextRouteVisit();
    };
    utterance.onerror = event => {
        if (!routeReadActive || event.error === 'canceled' || event.error === 'interrupted') return;
        routeReadActive = false;
        document.getElementById('readRouteButton').textContent = 'Đọc lộ trình';
        document.getElementById('readRouteStatus').textContent =
            'Trình duyệt không đọc được nội dung. Vui lòng thử lại.';
    };

    document.getElementById('readRouteStatus').textContent =
        `Đang đọc điểm ${visitNumber} / ${routeReadVisits.length}: ${customerName}`;
    window.speechSynthesis.speak(utterance);
}

function isOffRoute(item) {
    const value = String(item["Ngoài Tuyến"] ?? '').trim().toLocaleLowerCase();
    return value !== '' && !['0', 'false', 'no', 'n', 'không'].includes(value);
}

function normalizeVisitDate(value) {
    const text = String(value ?? '').trim();
    const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dayFirst) {
        return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
    }

    const yearFirst = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (yearFirst) {
        return `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`;
    }

    return text;
}

function findCell(row, headerMap, ...names) {
    for (const name of names) {
        const index = headerMap.get(normalizeHeader(name));
        if (index !== undefined) return row[index] ?? '';
    }
    return '';
}

function parseVisitSheet(worksheet) {
    const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false
    });
    const headerIndex = rows.findIndex(row => {
        const headers = new Set(row.map(normalizeHeader));
        const hasCustomerName = headers.has('tenkhachhang') ||
            headers.has('tenkhachhangdiemban');
        const hasLocation = headers.has('gpscheckin') ||
            headers.has('gpscheckout') ||
            (headers.has('vidolat') || headers.has('vido')) &&
            (headers.has('kinhdolng') || headers.has('kinhdo'));
        return headers.has('makhachhang') && hasCustomerName && hasLocation;
    });

    if (headerIndex < 0) {
        throw new Error('Không tìm thấy dòng tiêu đề có Mã Khách Hàng, Tên Khách Hàng và tọa độ GPS.');
    }

    const headerMap = new Map(
        rows[headerIndex].map((header, index) => [normalizeHeader(header), index])
    );

    return rows.slice(headerIndex + 1)
        .filter(row => row.some(value => String(value).trim() !== ''))
        .map(row => ({
            'STT': findCell(row, headerMap, 'STT'),
            'Mã Khách Hàng': findCell(row, headerMap, 'Mã Khách Hàng'),
            'Tên Khách Hàng': findCell(row, headerMap, 'Tên Khách Hàng'),
            'Địa Chỉ KH': findCell(row, headerMap, 'Địa Chỉ KH', 'Địa Chỉ Khách Hàng'),
            'Ngày Viếng Thăm': findCell(row, headerMap, 'Ngày Viếng Thăm'),
            'Check-in': findCell(row, headerMap, 'Check-in', 'Giờ Check-in'),
            'Check-out': findCell(row, headerMap, 'Check-out', 'Giờ Check-out'),
            'Đóng Cửa': findCell(row, headerMap, 'Đóng Cửa'),
            'Lý Do': findCell(row, headerMap, 'Lý Do'),
            'Trong Tuyến': findCell(row, headerMap, 'Trong Tuyến'),
            'Ngoài Tuyến': findCell(row, headerMap, 'Ngoài Tuyến'),
            'Tổng Thời Gian Check In & Check Out': findCell(
                row, headerMap, 'Tổng Thời Gian Check In & Check Out'
            ),
            'Số Tiền': findCell(row, headerMap, 'Số Tiền'),
            'GPS Check-in': findCell(row, headerMap, 'GPS Check-in'),
            'GPS Check-out': findCell(row, headerMap, 'GPS Check-out'),
            'Khoảng cách': findCell(row, headerMap, 'Khoảng cách'),
            'Mã NVBH': findCell(row, headerMap, 'Mã NVBH', 'Mã Nhân Viên'),
            'Tên NVBH': findCell(row, headerMap, 'Tên NVBH', 'Tên Nhân Viên'),
            'Vĩ Độ (Lat)': findCell(row, headerMap, 'Vĩ Độ (Lat)', 'Vĩ Độ', 'Latitude', 'Lat'),
            'Kinh Độ (Lng)': findCell(row, headerMap, 'Kinh Độ (Lng)', 'Kinh Độ', 'Longitude', 'Lng'),
            'Tên Khách Hàng / Điểm Bán': findCell(
                row, headerMap, 'Tên Khách Hàng / Điểm Bán'
            ),
            'Giờ Check-in': findCell(row, headerMap, 'Giờ Check-in'),
            'Giờ Check-out': findCell(row, headerMap, 'Giờ Check-out'),
            'Trạng Thái': findCell(row, headerMap, 'Trạng Thái'),
            'Ghi Chú Viếng Thăm': findCell(row, headerMap, 'Ghi Chú Viếng Thăm')
        }));
}

// 1. Tính khoảng cách Haversine (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 2. Hiển thị dữ liệu từ Excel lên Bản đồ
function loadDataToMap(data, drawRoute = false) {
    markersLayer.clearLayers();
    polylineLayer.clearLayers();
    currentMapData = data;
    const renderVersion = ++mapRenderVersion;

    const orderedData = data
        .map((item, originalIndex) => ({
            item,
            originalIndex,
            visitTime: parseVisitTime(item["Check-in"] || item["Giờ Check-in"])
        }))
        .sort((a, b) => {
            if (a.visitTime === null && b.visitTime === null) {
                return a.originalIndex - b.originalIndex;
            }
            if (a.visitTime === null) return 1;
            if (b.visitTime === null) return -1;
            return a.visitTime - b.visitTime || a.originalIndex - b.originalIndex;
        });

    return new Promise((resolve, reject) => {
        const latLngs = [];
        const markerBounds = L.latLngBounds([]);
        let totalDist = 0;
        let visitCount = 0;
        let offRouteCount = 0;
        let previousCoordinate = null;
        let index = 0;

        function renderBatch() {
            if (renderVersion !== mapRenderVersion) {
                resolve();
                return;
            }

            try {
                const batchEnd = Math.min(index + 300, orderedData.length);
                for (; index < batchEnd; index++) {
                    const { item, visitTime } = orderedData[index];
                    const coordinates = getVisitCoordinates(item);
                    if (!coordinates) continue;
                    markerBounds.extend(coordinates);

                    const customerName = item["Tên Khách Hàng"] ||
                        item["Tên Khách Hàng / Điểm Bán"] || "Khách hàng";
                    const hasVisitTime = visitTime !== null;
                    const offRoute = isOffRoute(item);
                    const visitNumber = hasVisitTime ? ++visitCount : null;

                    if (hasVisitTime) {
                        if (offRoute) offRouteCount++;
                        if (drawRoute) {
                            if (previousCoordinate) {
                                totalDist += calculateDistance(
                                    previousCoordinate[0], previousCoordinate[1],
                                    coordinates[0], coordinates[1]
                                );
                            }
                            previousCoordinate = coordinates;
                            latLngs.push(coordinates);
                        }
                    }

                    const marker = L.circleMarker(coordinates, {
                        renderer: canvasRenderer,
                        radius: 10,
                        color: '#fff',
                        weight: 2,
                        fillColor: offRoute ? '#f28c28' : hasVisitTime ? '#007bff' : '#6c757d',
                        fillOpacity: 1
                    });
                    if (drawRoute && hasVisitTime) {
                        marker.bindTooltip(String(visitNumber), {
                            permanent: true,
                            direction: 'top',
                            className: 'visit-number-label',
                            offset: [0, -8]
                        });
                    }
                    marker.bindPopup(() => [
                        hasVisitTime
                            ? `<b>Lượt viếng thăm #${visitNumber}: ${escapeHtml(customerName)}</b>`
                            : `<b>${escapeHtml(customerName)} (không có giờ check-in, không tính thứ tự)</b>`,
                        offRoute && '<b>Điểm ngoài tuyến</b>',
                        item["Mã Khách Hàng"] &&
                            `Mã khách hàng: ${escapeHtml(item["Mã Khách Hàng"])}`,
                        (item["Tên NVBH"] || item["Mã NVBH"]) &&
                            `NVBH: ${escapeHtml(item["Tên NVBH"] || item["Mã NVBH"])}`,
                        item["Địa Chỉ KH"] && `Địa chỉ: ${escapeHtml(item["Địa Chỉ KH"])}`,
                        `Tọa độ: ${coordinates[0].toFixed(6)}, ${coordinates[1].toFixed(6)}`,
                        item["Ngày Viếng Thăm"] &&
                            `Ngày viếng thăm: ${escapeHtml(item["Ngày Viếng Thăm"])}`,
                        `Check-in: ${escapeHtml(item["Check-in"] || item["Giờ Check-in"] || "--")}`,
                        `Check-out: ${escapeHtml(item["Check-out"] || item["Giờ Check-out"] || "--")}`,
                        item["Đóng Cửa"] && `Đóng cửa: ${escapeHtml(item["Đóng Cửa"])}`,
                        item["Lý Do"] && `Lý do: ${escapeHtml(item["Lý Do"])}`,
                        item["Trong Tuyến"] && `Trong tuyến: ${escapeHtml(item["Trong Tuyến"])}`,
                        item["Ngoài Tuyến"] && `Ngoài tuyến: ${escapeHtml(item["Ngoài Tuyến"])}`,
                        item["Tổng Thời Gian Check In & Check Out"] &&
                            `Tổng thời gian: ${escapeHtml(item["Tổng Thời Gian Check In & Check Out"])}`,
                        item["Số Tiền"] && `Số tiền: ${escapeHtml(item["Số Tiền"])}`,
                        item["GPS Check-in"] &&
                            `GPS Check-in: ${escapeHtml(item["GPS Check-in"])}`,
                        item["GPS Check-out"] &&
                            `GPS Check-out: ${escapeHtml(item["GPS Check-out"])}`,
                        item["Khoảng cách"] !== '' && item["Khoảng cách"] !== undefined &&
                            `Khoảng cách: ${escapeHtml(item["Khoảng cách"])}`,
                        item["Trạng Thái"] && `Trạng thái: ${escapeHtml(item["Trạng Thái"])}`,
                        item["Ghi Chú Viếng Thăm"] &&
                            `Ghi chú: ${escapeHtml(item["Ghi Chú Viếng Thăm"])}`
                    ].filter(Boolean).join('<br>'));
                    markersLayer.addLayer(marker);
                }

                if (index < orderedData.length) {
                    document.getElementById('importStatus').textContent =
                        `Đang hiển thị ${index.toLocaleString('vi-VN')} / ` +
                        `${orderedData.length.toLocaleString('vi-VN')} dòng...`;
                    requestAnimationFrame(renderBatch);
                    return;
                }

                if (!drawRoute) {
                    if (markerBounds.isValid()) {
                        map.fitBounds(markerBounds, { padding: [30, 30], maxZoom: 12 });
                    }
                }

                if (drawRoute && latLngs.length > 1) {
                    const polyline = L.polyline(latLngs, {
                        renderer: canvasRenderer,
                        color: '#007bff',
                        weight: 4,
                        dashArray: '5, 5'
                    });
                    polylineLayer.addLayer(polyline);
                    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
                }

                document.getElementById('kpiTotal').innerText = visitCount;
                document.getElementById('kpiOffRoute').innerText = offRouteCount;
                document.getElementById('kpiDistance').innerText = totalDist.toFixed(2) + " km";
                resolve();
            } catch (error) {
                reject(error);
            }
        }

        requestAnimationFrame(renderBatch);
    });
}

// 3. Cập nhật gợi ý mã và tên nhân viên
function updateSelectOptions(data) {
    const input = document.getElementById('nvbhSelect');
    const options = document.getElementById('nvbhOptions');
    const employees = new Map();
    data.forEach(item => {
        const code = String(item["Mã NVBH"] || '').trim();
        const name = String(item["Tên NVBH"] || '').trim();
        const label = [code, name].filter(Boolean).join(' - ');
        if (label) employees.set(label, label);
    });
    options.replaceChildren();
    input.value = '';

    if (employees.size === 0) {
        input.placeholder = 'File không có thông tin NVBH';
        input.disabled = true;
        return;
    }

    input.disabled = false;
    input.placeholder = '-- Tất cả NVBH --';
    employees.forEach(employee => {
        const option = document.createElement('option');
        option.value = employee;
        options.append(option);
    });
}

function getEmployeeKey(item) {
    return [
        String(item["Mã NVBH"] || '').trim().toLocaleLowerCase(),
        String(item["Tên NVBH"] || '').trim().toLocaleLowerCase()
    ].join('|');
}

function findSelectedEmployee(query) {
    if (!query) return null;

    const matches = new Set();
    allData.forEach(item => {
        const code = String(item["Mã NVBH"] || '').trim();
        const name = String(item["Tên NVBH"] || '').trim();
        const exactValues = [code, name, [code, name].filter(Boolean).join(' - ')]
            .filter(Boolean)
            .map(value => value.toLocaleLowerCase());
        if (exactValues.includes(query)) matches.add(getEmployeeKey(item));
    });

    return matches.size === 1 ? [...matches][0] : null;
}

function applyFilters() {
    stopRouteReading();
    const employeeQuery = document.getElementById('nvbhSelect')
        .value.trim().toLocaleLowerCase();
    const selectedDate = document.getElementById('visitDateSelect').value;
    const selectedEmployee = findSelectedEmployee(employeeQuery);
    const routeButton = document.getElementById('googleMapsRouteButton');
    const readRouteButton = document.getElementById('readRouteButton');
    const routeLinks = document.getElementById('googleMapsRouteLinks');
    routeButton.disabled = !selectedEmployee;
    readRouteButton.disabled = !selectedEmployee;
    routeLinks.replaceChildren();
    routeLinks.textContent = selectedEmployee
        ? ''
        : 'Chọn đúng một mã/tên NVBH để xem tuyến và mở trên Google Maps.';

    const filtered = allData.filter(item => {
        const employee = [
            String(item["Mã NVBH"] || '').trim(),
            String(item["Tên NVBH"] || '').trim()
        ].filter(Boolean).join(' - ').toLocaleLowerCase();
        const matchesEmployee = !employeeQuery || employee.includes(employeeQuery);
        const matchesDate = !selectedDate ||
            normalizeVisitDate(item["Ngày Viếng Thăm"]) === selectedDate;
        return matchesEmployee && matchesDate;
    });

    const routeData = selectedEmployee
        ? filtered.filter(item => getEmployeeKey(item) === selectedEmployee)
        : filtered;
    return loadDataToMap(routeData, Boolean(selectedEmployee));
}

// 4. ĐỌC FILE EXCEL TẢI LÊN
document.getElementById('excelFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const importStatus = document.getElementById('importStatus');
    importStatus.textContent = `Đang tải file ${file.name}...`;
    const reader = new FileReader();
    reader.onload = function(event) {
        importStatus.textContent = 'Đang phân tích Excel và vẽ các điểm...';
        setTimeout(() => {
            let excelData;
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                excelData = parseVisitSheet(worksheet);

                if (excelData.length === 0) {
                    importStatus.textContent = 'Không có dữ liệu bên dưới dòng tiêu đề.';
                    alert("Không có dữ liệu khách hàng bên dưới dòng tiêu đề.");
                    return;
                }

                allData = excelData;
                updateSelectOptions(allData);
                document.getElementById('visitDateSelect').value = '';
                importStatus.textContent =
                    `Đã đọc ${excelData.length.toLocaleString('vi-VN')} dòng, đang vẽ bản đồ...`;
                applyFilters().then(() => {
                    importStatus.textContent =
                        `Đã đọc ${excelData.length.toLocaleString('vi-VN')} dòng.`;
                    alert("Trích xuất và đọc file Excel thành công!");
                }).catch(error => {
                    importStatus.textContent = `Lỗi hiển thị dữ liệu: ${error.message}`;
                    alert(`Không thể hiển thị dữ liệu: ${error.message}`);
                });
            } catch (error) {
                importStatus.textContent = `Lỗi đọc file: ${error.message}`;
                alert(`Không thể đọc file Excel: ${error.message}`);
            }
        }, 0);
    };
    reader.onerror = () => {
        importStatus.textContent = 'Không thể đọc file đã chọn.';
        alert("Không thể đọc file đã chọn.");
    };
    reader.readAsArrayBuffer(file);
});

// 5. Bộ lọc NVBH theo mã hoặc tên
document.getElementById('nvbhSelect').addEventListener('input', (e) => {
    applyFilters();
});
document.getElementById('nvbhSelect').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.currentTarget.value = '';
        applyFilters();
    }
});
document.getElementById('visitDateSelect').addEventListener('change', applyFilters);

document.getElementById('readRouteButton').addEventListener('click', () => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
        document.getElementById('readRouteStatus').textContent =
            'Trình duyệt này không hỗ trợ đọc văn bản.';
        return;
    }

    if (routeReadActive) {
        stopRouteReading();
        return;
    }

    routeReadVisits = currentMapData
        .map((item, originalIndex) => ({
            item,
            originalIndex,
            visitTime: parseVisitTime(item["Check-in"] || item["Giờ Check-in"])
        }))
        .filter(visit => visit.visitTime !== null)
        .sort((a, b) => a.visitTime - b.visitTime || a.originalIndex - b.originalIndex)
        .map((visit, index) => ({ item: visit.item, visitNumber: index + 1 }));

    if (routeReadVisits.length === 0) {
        document.getElementById('readRouteStatus').textContent =
            'Không có điểm nào có giờ check-in để đọc.';
        return;
    }

    routeReadIndex = 0;
    routeReadActive = true;
    document.getElementById('readRouteButton').textContent = 'Dừng đọc';
    speakNextRouteVisit();
});

document.getElementById('googleMapsRouteButton').addEventListener('click', () => {
    if (!findSelectedEmployee(
        document.getElementById('nvbhSelect').value.trim().toLocaleLowerCase()
    )) {
        return;
    }

    const visits = currentMapData
        .map((item, originalIndex) => ({
            coordinates: getVisitCoordinates(item),
            visitTime: parseVisitTime(item["Check-in"] || item["Giờ Check-in"]),
            originalIndex
        }))
        .filter(visit => visit.coordinates && visit.visitTime !== null)
        .sort((a, b) => a.visitTime - b.visitTime || a.originalIndex - b.originalIndex);
    const linksContainer = document.getElementById('googleMapsRouteLinks');
    linksContainer.replaceChildren();

    if (visits.length === 0) {
        linksContainer.textContent = 'Không có điểm nào vừa có tọa độ vừa có giờ check-in.';
        return;
    }

    const chunkSize = 10;
    const step = chunkSize - 1;
    for (let start = 0, section = 1; start < visits.length; start += step, section++) {
        const stops = visits.slice(start, start + chunkSize)
            .map(visit => visit.coordinates.join(','));
        const params = new URLSearchParams({
            api: '1',
            destination: stops[stops.length - 1],
            travelmode: 'driving'
        });
        if (stops.length > 1) params.set('origin', stops[0]);
        if (stops.length > 2) {
            params.set('waypoints', stops.slice(1, -1).join('|'));
        }

        const link = document.createElement('a');
        link.href = `https://www.google.com/maps/dir/?${params.toString()}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = visits.length > chunkSize
            ? `Mở chặng ${section} (điểm ${start + 1}–${start + stops.length})`
            : 'Mở tuyến Google Maps';
        linksContainer.append(link);
    }
});