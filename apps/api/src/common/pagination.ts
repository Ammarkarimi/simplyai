export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
