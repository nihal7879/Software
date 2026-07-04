import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// Master-data lists that drive the app dropdowns, fetched from /api/masters
// (backed by the year_grades / venues / exam_boards / schools tables).
// Fallbacks keep the form usable if the request is still in flight or fails.
export type Masters = {
  year_grades: string[];
  venues: string[];
  exam_boards: string[];
  schools: string[];
};

export const MASTER_FALLBACK: Masters = {
  year_grades: ['Y7', 'Y8', 'Y9', 'Y10', 'Y11', 'Y12', 'Y13'],
  venues: ['JLT', 'Oud Metha', 'Online'],
  exam_boards: ['IGCSE', 'IB', 'IAL', 'Edexcel', 'AQA', 'OCR', 'CAIE', 'CBSE'],
  schools: ['GEMS', 'Jumeirah College', 'Dubai College', 'Repton School', 'Other'],
};

export function useMasters(): Masters {
  const { data } = useQuery({
    queryKey: ['masters'],
    queryFn: () => api.get('/masters').then((r) => r.data as Masters),
    staleTime: 30 * 60 * 1000, // master data changes rarely
  });
  return {
    year_grades: data?.year_grades?.length ? data.year_grades : MASTER_FALLBACK.year_grades,
    venues: data?.venues?.length ? data.venues : MASTER_FALLBACK.venues,
    exam_boards: data?.exam_boards?.length ? data.exam_boards : MASTER_FALLBACK.exam_boards,
    schools: data?.schools?.length ? data.schools : MASTER_FALLBACK.schools,
  };
}
