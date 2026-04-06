export interface Department {
  id: string;
  name: string;
  color: string;
  createdAt?: unknown;
}

export async function fetchDepartments(): Promise<Department[]> {
  const res = await fetch("/api/departments");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching departments");
  return data.departments;
}

export async function createDepartment(name: string, color: string): Promise<Department> {
  const res = await fetch("/api/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating department");
  return data.department;
}

export async function updateDepartment(id: string, name: string, color: string): Promise<void> {
  const res = await fetch(`/api/departments/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating department");
}

export async function deleteDepartment(id: string): Promise<void> {
  const res = await fetch(`/api/departments/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting department");
}
