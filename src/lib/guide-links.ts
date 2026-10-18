/** Đường dẫn dùng chung cho menu, trang chủ và các bài hướng dẫn. */
export const moduleGuideHref = (moduleKey: string, topic?: string) =>
  `/guide/modules/${encodeURIComponent(moduleKey)}${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`;

export const roleGuideHref = (roleKey: string) => `/guide/roles/${encodeURIComponent(roleKey)}`;
