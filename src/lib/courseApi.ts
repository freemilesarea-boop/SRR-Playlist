/**
 * 수강신청 상품 — API 래퍼 (유저 + 관리자).
 */
import { supabase } from './supabase';
import type { CourseOrderStatus } from './courseProduct';

export interface ActiveCourseProduct {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price: number;
  capacity: number | null;
  sold: number;
  remaining: number | null;
  sort_order: number;
}

export interface AdminCourseProduct {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price: number;
  capacity: number | null;
  is_active: boolean;
  sort_order: number;
  paid_count: number;
  revenue: number;
  created_at: string;
}

export interface CourseEnrollment {
  order_id: string;
  order_no: string;
  product_id: string;
  product_name: string;
  user_id: string;
  email: string | null;
  nickname: string | null;
  amount: number;
  status: CourseOrderStatus;
  recvphone: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface CourseOrderStatusResult {
  order_no: string;
  status: CourseOrderStatus;
  paid: boolean;
  amount: number;
  product_name: string;
  paid_at: string | null;
}

/* ── 유저 ── */

export async function fetchActiveCourseProducts(): Promise<ActiveCourseProduct[]> {
  const { data, error } = await supabase.rpc('list_active_course_products');
  if (error) throw error;
  return (data ?? []) as ActiveCourseProduct[];
}

export async function createCoursePayment(input: {
  productId: string; recvphone: string; buyerName?: string;
}): Promise<{ ok: boolean; payurl?: string; order_no?: string; error?: string; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('create-course-payment', {
    body: { product_id: input.productId, recvphone: input.recvphone, buyer_name: input.buyerName },
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; payurl?: string; order_no?: string; error?: string; reason?: string };
}

export async function getMyCourseOrderStatus(orderNo: string): Promise<CourseOrderStatusResult | null> {
  const { data, error } = await supabase.rpc('get_my_course_order_status', { p_order_no: orderNo });
  if (error) throw error;
  return (data ?? null) as CourseOrderStatusResult | null;
}

/* ── 관리자 ── */

export async function adminListCourseProducts(): Promise<AdminCourseProduct[]> {
  const { data, error } = await supabase.rpc('admin_list_course_products');
  if (error) throw error;
  return (data ?? []) as AdminCourseProduct[];
}

export async function adminCreateCourseProduct(p: {
  name: string; description: string; category: string | null; price: number; capacity: number | null; sort_order: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_course_product', {
    p_name: p.name, p_description: p.description, p_category: p.category,
    p_price: p.price, p_capacity: p.capacity, p_sort_order: p.sort_order,
  });
  if (error) throw error;
  return data as string;
}

export async function adminUpdateCourseProduct(id: string, p: {
  name: string; description: string; category: string | null; price: number; capacity: number | null; sort_order: number;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_update_course_product', {
    p_id: id, p_name: p.name, p_description: p.description, p_category: p.category,
    p_price: p.price, p_capacity: p.capacity, p_sort_order: p.sort_order,
  });
  if (error) throw error;
}

export async function adminSetCourseProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_course_product_active', { p_id: id, p_active: active });
  if (error) throw error;
}

export async function adminDeleteCourseProduct(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_course_product', { p_id: id });
  if (error) throw error;
}

export async function adminListCourseEnrollments(productId?: string | null, limit = 200, offset = 0): Promise<CourseEnrollment[]> {
  const { data, error } = await supabase.rpc('admin_list_course_enrollments', {
    p_product_id: productId ?? null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as CourseEnrollment[];
}
