/**
 * Chiều cao BottomNav (fixed, chỉ < md) và độ lệch `bottom` tương ứng cho phần tử sticky đáy trong vùng cuộn
 * (footer `/new`). Phải là chuỗi class ĐẦY ĐỦ để Tailwind quét được; 2 hằng này đi đôi (h-14 = 3.5rem = bottom-14).
 * Đổi chiều cao BottomNav → đổi cả hai (có test canh sự khớp).
 */
export const BOTTOM_NAV_HEIGHT = "h-14";
export const BOTTOM_NAV_OFFSET = "max-md:bottom-14";
