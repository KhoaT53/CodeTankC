export const PLAYER_STARTER_CODE = `// =========================================================
// CODETANK OXY: CHƯƠNG TRÌNH AI CHÍNH (C++ STANDARD API)
// Hệ trục Oxy: Gốc (0,0) ở GÓC DƯỚI-TRÁI, X tăng sang Phải, Y tăng lên Trên
// =========================================================

int patrolStep = 0;

void setup() {
    // Khởi tạo vị trí ban đầu vào khu vực trung tâm đảo
    moveTo(14, 14, false, "SHORTEST");
}

void loop() {
    // 1. Tự nạp đạn ngay khi hết đạn
    if (getAmmo() == 0) {
        reload();
    }

    // 2. Nếu máu thấp (<= 3), ưu tiên tìm Tim Hồi Máu trên bản đồ
    if (getHP() <= 3) {
        pair<int, int> heart = getNearestItemPos("HEART_2");
        if (heart.first == -1) {
            heart = getNearestItemPos("HEART_1");
        }
        if (heart.first != -1) {
            moveTo(heart.first, heart.second, true, "SAFEST");
            return;
        }
    }

    // 3. Quét cảm biến 360 độ (bán kính 20 ô)
    EnemyInfo target = getNearestEnemyInfo();

    if (target.id != -1) {
        // Kích hoạt kỹ năng đặc biệt khi đối đầu địch trong tầm
        if (isSkillReady() && target.dist <= 12.0) {
            useSkill((int)target.x, (int)target.y);
        }

        if (target.status == 1) {
            // Thấy rõ địch (không bị chắn): Xả 2 viên trực diện
            autoFire(2, "DIRECT");

            // Giữ khoảng cách chiến thuật
            if (target.dist < 5.0 && isDashReady()) {
                dash((target.angle + 180) % 360);
            } else if (target.dist > 8.0) {
                moveTo((int)target.x, (int)target.y, false, "SHORTEST");
            } else {
                moveDir((target.angle + 90) % 360, 2);
            }
        } else if (target.status == 2) {
            // Địch nấp sau thùng gỗ (2) hoặc tảng đá (3): Bắn bật tường hoặc phá vật cản
            autoFire(2, "RICOCHET");
            moveTo((int)target.x, (int)target.y, false, "SHORTEST");
        }
    } else {
        // 4. Không thấy địch: Thu thập vật phẩm bất kỳ hoặc tuần tra 4 góc đảo
        pair<int, int> item = getNearestItemPos("ANY");
        if (item.first != -1) {
            moveTo(item.first, item.second, false, "SHORTEST");
        } else {
            if (patrolStep % 4 == 0) moveTo(8, 21, false, "SHORTEST");
            else if (patrolStep % 4 == 1) moveTo(21, 21, false, "SHORTEST");
            else if (patrolStep % 4 == 2) moveTo(21, 8, false, "SHORTEST");
            else moveTo(8, 8, false, "SHORTEST");
            patrolStep++;
        }
    }
}
`;

export interface CodePreset {
  id: string;
  nameVi: string;
  badgeVi: string;
  code: string;
}

export const PLAYER_CODE_PRESETS: CodePreset[] = [
  {
    id: 'balanced',
    nameVi: 'Cân Bằng Chiến Thuật',
    badgeVi: 'Mặc định',
    code: PLAYER_STARTER_CODE,
  },
  {
    id: 'sniper_ricochet',
    nameVi: 'Xạ Thủ Bật Tường (Ricochet)',
    badgeVi: 'Bắn Phản Xạ',
    code: `// CHIẾN THUẬT: XẠ THỦ BẬT TƯỜNG & GIỮ KHOẢNG CÁCH AN TOÀN
int cornerIdx = 0;

void setup() {
    moveTo(10, 10, true, "SAFEST");
}

void loop() {
    if (getAmmo() <= 1) {
        reload();
    }

    // Ưu tiên nhặt Hộp Đạn hoặc Đạn Đẩy Lùi
    pair<int, int> kbItem = getNearestItemPos("KNOCKBACK");
    if (kbItem.first != -1) {
        moveTo(kbItem.first, kbItem.second, true, "SAFEST");
    }

    vector<EnemyInfo> enemies = getAllVisibleEnemies();
    if (enemies.size() > 0) {
        EnemyInfo e = enemies[0];

        if (isSkillReady()) {
            useSkill(15, 15);
        }

        // Bắn bật tường gạch nếu bị chắn, hoặc bắn trực diện
        if (e.status == 2) {
            autoFire(3, "RICOCHET");
        } else {
            autoFire(2, "DIRECT");
        }

        // Lướt né nếu địch áp sát dưới 5 ô
        if (e.dist < 5.5) {
            if (isDashReady()) {
                dash((e.angle + 180) % 360);
            } else {
                moveTo(29 - (int)e.x, 29 - (int)e.y, true, "SAFEST");
            }
        }
    } else {
        pair<int, int> anyItem = getNearestItemPos("ANY");
        if (anyItem.first != -1) {
            moveTo(anyItem.first, anyItem.second, false, "SHORTEST");
        } else {
            int tx = (cornerIdx % 2 == 0) ? 7 : 22;
            int ty = (cornerIdx < 2) ? 7 : 22;
            moveTo(tx, ty, true, "SAFEST");
            cornerIdx = (cornerIdx + 1) % 4;
        }
    }
}
`,
  },
  {
    id: 'rusher_knockback',
    nameVi: 'Đột Kích Đẩy Lùi Ra Biển',
    badgeVi: 'Tấn Công Mạnh',
    code: `// CHIẾN THUẬT: ÁP SÁT & ĐẨY LÙI ĐỊCH XUỐNG VỰC NƯỚC (-1)
void setup() {
    moveTo(15, 15, false, "SHORTEST");
}

void loop() {
    if (getAmmo() == 0) {
        reload();
    }

    EnemyInfo e = getNearestEnemyInfo();
    if (e.id != -1) {
        // Bật kỹ năng ngay khi phát hiện mục tiêu
        if (isSkillReady()) {
            useSkill((int)e.x, (int)e.y);
        }

        // Lướt áp sát nhanh nếu khoảng cách > 6 ô
        if (e.dist > 6.0 && isDashReady()) {
            dash(e.angle);
        }

        // Xả đạn liên hoàn đẩy lùi địch
        autoFire(3, "DIRECT");
        moveTo((int)e.x, (int)e.y, false, "SHORTEST");
    } else {
        pair<int, int> item = getNearestItemPos("ANY");
        if (item.first != -1) {
            moveTo(item.first, item.second, false, "SHORTEST");
        } else {
            moveTo(15, 15, false, "SHORTEST");
        }
    }
}
`,
  },
  {
    id: 'item_hunter',
    nameVi: 'Thợ Săn Vật Phẩm & Sinh Tồn',
    badgeVi: 'Kiểm Soát Đảo',
    code: `// CHIẾN THUẬT: KIỂM SOÁT VẬT PHẨM & PHẢN CÔNG CHẮC CHẮN
int sweepY = 6;

void setup() {
    moveTo(12, 12, true, "SAFEST");
}

void loop() {
    if (getAmmo() == 0) reload();

    // Quét vật phẩm theo thứ tự ưu tiên
    pair<int, int> targetItem = getNearestItemPos("HEART_2");
    if (targetItem.first == -1 && getHP() < 5) targetItem = getNearestItemPos("HEART_1");
    if (targetItem.first == -1) targetItem = getNearestItemPos("CLOCK");
    if (targetItem.first == -1) targetItem = getNearestItemPos("KNOCKBACK");
    if (targetItem.first == -1) targetItem = getNearestItemPos("ANY");

    pair<int, int> sensor = getNearestEnemyAngleStatus();
    if (sensor.first != -1) {
        if (isSkillReady()) useSkill(14, 14);
        if (sensor.second == 1) {
            shoot(sensor.first);
        } else {
            autoFire(2, "RICOCHET");
        }
    }

    if (targetItem.first != -1) {
        moveTo(targetItem.first, targetItem.second, true, "SAFEST");
    } else {
        moveTo(15, sweepY, true, "SAFEST");
        sweepY = (sweepY == 6) ? 23 : 6;
    }
}
`,
  },
];

export const LIVE_OVERRIDE_SNIPPETS: Array<{ label: string; code: string }> = [
  {
    label: 'Lướt Bắc + Xả 3 Viên Bật Tường',
    code: `dash("N");\nautoFire(3, "RICOCHET");`,
  },
  {
    label: 'Quét 8 Hướng Đạn Vòng Tròn',
    code: `for (int a = 0; a < 360; a += 45) {\n    shoot(a);\n}\nreload();`,
  },
  {
    label: 'Dùng Kỹ Năng + Rút Về Tâm Đảo (15, 15)',
    code: `if (isSkillReady()) {\n    useSkill(15, 15);\n}\nmoveTo(15, 15, true, "SAFEST");`,
  },
  {
    label: 'Tìm Máu Khẩn Cấp & Lướt Thoát Giao Tranh',
    code: `pair<int, int> hp = getNearestItemPos("HEART_2");\nif (hp.first == -1) hp = getNearestItemPos("ANY");\nif (isDashReady()) dash("SW");\nif (hp.first != -1) moveTo(hp.first, hp.second, true, "SAFEST");`,
  },
];

export const BOT_EASY_CODE = `// BOT DỄ (TRINH SÁT): Tuần tra và bắn đơn khi thấy rõ mục tiêu
int step = 0;
void setup() {
    moveTo(6, 23, false, "SHORTEST");
}
void loop() {
    if (getAmmo() == 0) reload();
    pair<int, int> s = getNearestEnemyAngleStatus();
    if (s.first != -1 && s.second == 1) {
        shoot(s.first);
    }
    if (step % 2 == 0) moveDir("E", 4);
    else moveDir("S", 4);
    step++;
}
`;

export const BOT_MEDIUM_CODE = `// BOT TRUNG BÌNH (THỢ SĂN): Săn vật phẩm, dùng kỹ năng và bắn liên thanh
int patrol = 0;
void setup() {
    moveTo(23, 23, false, "SHORTEST");
}
void loop() {
    if (getAmmo() == 0) reload();
    EnemyInfo e = getNearestEnemyInfo();
    if (e.id != -1) {
        if (isSkillReady() && e.dist < 10.0) useSkill((int)e.x, (int)e.y);
        autoFire(2, "DIRECT");
        if (e.dist > 7.0) {
            moveTo((int)e.x, (int)e.y, false, "SHORTEST");
        } else {
            moveDir((e.angle + 90) % 360, 2);
        }
    } else {
        pair<int, int> it = getNearestItemPos("ANY");
        if (it.first != -1) moveTo(it.first, it.second, false, "SHORTEST");
        else {
            moveTo(patrol % 2 == 0 ? 22 : 8, 20, false, "SHORTEST");
            patrol++;
        }
    }
}
`;

export const BOT_HARD_CODE = `// BOT KHÓ (CAO THỦ OXY): Tính góc bật tường Ricochet, lướt né đạn & kiểm soát máu
void setup() {
    moveTo(22, 8, true, "SAFEST");
}
void loop() {
    if (getAmmo() == 0) reload();
    if (getHP() <= 2) {
        pair<int, int> h = getNearestItemPos("HEART_2");
        if (h.first == -1) h = getNearestItemPos("HEART_1");
        if (h.first != -1) {
            if (isDashReady()) dash("N");
            moveTo(h.first, h.second, true, "SAFEST");
            return;
        }
    }
    EnemyInfo e = getNearestEnemyInfo();
    if (e.id != -1) {
        if (isSkillReady()) useSkill((int)e.x, (int)e.y);
        if (e.status == 2) {
            autoFire(3, "RICOCHET");
        } else {
            autoFire(2, "DIRECT");
        }
        if (e.dist < 4.5 && isDashReady()) {
            dash((e.angle + 180) % 360);
        } else {
            moveTo((int)e.x, (int)e.y, true, "SAFEST");
        }
    } else {
        pair<int, int> it = getNearestItemPos("ANY");
        if (it.first != -1) moveTo(it.first, it.second, false, "SHORTEST");
        else moveTo(15, 15, false, "SHORTEST");
    }
}
`;
