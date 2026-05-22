// frontend/src/services/api.js
// Servicio central de API para ClinAI.

import axios from 'axios'
import { useAuthStore } from '../store/auth'

const fixMinioUrl = (url) => {
  if (!url) return url
  return url.replace(/https?:\/\/minio:9000/g, '/minio')
            .replace(/https?:\/\/localhost:9000/g, '/minio')
}

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: BASE })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout?.()
    }
    return Promise.reject(err)
  }
)

// ── Auth API ──────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (accessKey, permissionKey) =>
    api.post('/auth/login', null, {
      headers: {
        'X-Access-Key': accessKey,
        'X-Permission-Key': permissionKey,
      },
    }),
  logout: () => api.post('/auth/logout'),
  acceptHabeasData: (policyVersion = '1.0') =>
    api.post('/auth/habeas-data', { policy_version: policyVersion }),
}

// ── FHIR API ──────────────────────────────────────────────────────────────────
export const fhirAPI = {
  listPatients: (params = {}) => {
    const { limit = 10, offset = 0, ...rest } = params
    return api.get('/fhir/Patient', { params: { limit, offset, ...rest } })
  },
  getPatient:        (id)   => api.get(`/fhir/Patient/${id}`),
  createPatient:     (body) => api.post('/fhir/Patient', body),
  createPatientFull: (body) => api.post('/fhir/Patient/full', body),
  deletePatient:     (id)   => api.delete(`/fhir/Patient/${id}`),
  restorePatient:    (id)   => api.patch(`/fhir/Patient/${id}/restore`),
  canClose:          (id)   => api.get(`/fhir/Patient/${id}/can-close`),

  listObservations: (patientId, limit = 50, offset = 0) =>
    api.get('/fhir/Observation', { params: { subject: patientId, limit, offset } }),
  createObservation: (body) => api.post('/fhir/Observation', body),

  listMedia: async (patientId, limit = 20) => {
    const res = await api.get('/fhir/Media', {
      params: { subject: patientId, limit, presign: true }
    })
    if (res.data?.entry) {
      res.data.entry = res.data.entry.map((m) => ({
        ...m,
        url: fixMinioUrl(m.presigned_url),
      }))
    }
    return res
  },

  getMediaUrl: async (mediaId) => {
    const res = await api.get(`/fhir/Media/${mediaId}/url`)
    if (res.data?.url) res.data.url = fixMinioUrl(res.data.url)
    return res
  },

  uploadImage: (patientId, file, modality = 'FUNDUS') => {
    const fd = new FormData()
    fd.append('patient_id', patientId)
    fd.append('modality', modality)
    fd.append('file', file)
    return api.post('/fhir/Media/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  listRiskReports: async (patientId, limit = 20) => {
    const res = await api.get('/fhir/RiskAssessment', { params: { subject: patientId, limit } })
    if (res.data?.entry) {
      res.data.entry = res.data.entry.map(r => ({
        ...r,
        gradcam_url:  fixMinioUrl(r.gradcam_url),
        original_url: fixMinioUrl(r.original_url),
      }))
    }
    return res
  },
  getRiskReport: async (rid) => {
    const res = await api.get(`/fhir/RiskAssessment/${rid}`)
    if (res.data?.gradcam_url)  res.data.gradcam_url  = fixMinioUrl(res.data.gradcam_url)
    if (res.data?.original_url) res.data.original_url = fixMinioUrl(res.data.original_url)
    return res
  },
  signReport: (rid, body) => api.patch(`/fhir/RiskAssessment/${rid}/sign`, body),
}

// ── Inference API ─────────────────────────────────────────────────────────────
export const inferAPI = {
  request: (patientId, modelType) => {
    const { userId } = useAuthStore.getState()
    return api.post('/infer', {
      patient_id:   patientId,
      model_type:   modelType,
      requested_by: userId,
    })
  },
  status: (taskId) =>
    api.get(`/infer/${taskId}`),

  // ✅ Usa el backend como proxy — evita CORS con el orquestador directo
  // El endpoint /infer/{id}/result devuelve el resultado completo incluyendo
  // shap_values, gradcam_url, original_url cuando status === DONE
  result: (taskId) =>
    api.get(`/infer/${taskId}/result`),
}

// ── Admin API ─────────────────────────────────────────────────────────────────
export const adminAPI = {
  stats:    () => api.get('/admin/stats'),
  getStats: () => api.get('/admin/stats'),

  listUsers: (params) => {
    const limit           = params?.limit           ?? 20
    const offset          = params?.offset          ?? 0
    const include_deleted = params?.include_deleted ?? false
    const role            = params?.role            ?? undefined
    return api.get('/admin/users', { params: { limit, offset, include_deleted, role } })
  },

  createUser:  (body)   => api.post('/admin/users', body),
  updateUser:  (uid, b) => api.patch(`/admin/users/${uid}`, b),
  deleteUser:  (uid)    => api.delete(`/admin/users/${uid}`),
  restoreUser: (uid)    => api.patch(`/admin/users/${uid}/restore`),

  regenKeys:      (uid) => api.post(`/admin/users/${uid}/regenerate-keys`),
  regenerateKeys: (uid) => api.post(`/admin/users/${uid}/regenerate-keys`),

  auditLog:    (params) => api.get('/admin/audit-log', { params }),
  getAuditLog: (params) => api.get('/admin/audit-log', { params }),

  exportAudit: (fmt) => api.get('/admin/audit-log/export', {
    params: { fmt }, responseType: 'blob'
  }),
  exportAuditLog: (fmt) => api.get('/admin/audit-log/export', {
    params: { fmt }, responseType: fmt === 'csv' ? 'blob' : 'json'
  }),

  migratePatientUsers: () => api.post('/admin/migrate-patients-to-users'),

  listPractitioners:   (params) => api.get('/admin/practitioners', { params }),
  createPractitioner:  (body)   => api.post('/admin/practitioners', body),
  togglePractitioner:  (pid)    => api.patch(`/admin/practitioners/${pid}`),

  modelMetrics: () => api.get('/admin/model-metrics'),
}

// ── Assignment API ────────────────────────────────────────────────────────────
export const assignmentAPI = {
  list:                (params) => api.get('/admin/assignments', { params }),
  create:              (body)   => api.post('/admin/assignments', body),
  remove:              (aid)    => api.delete(`/admin/assignments/${aid}`),
  listDoctors:         ()       => api.get('/admin/assignments/doctors'),
  listPatients:        ()       => api.get('/admin/assignments/patients'),
  listPractitioners:   ()       => api.get('/admin/assignments/practitioners'),
}

// ── Practitioner Assignment API ───────────────────────────────────────────────
export const practitionerAssignmentAPI = {
  list:   (params) => api.get('/admin/practitioner-assignments', { params }),
  create: (body)   => api.post('/admin/practitioner-assignments', body),
  remove: (aid)    => api.delete(`/admin/practitioner-assignments/${aid}`),
}

// ── ARCO API (Ley 1581/2012) ──────────────────────────────────────────────────
export const arcoAPI = {
  submit:  (type, message) => api.post('/admin/arco-request', { type, message }),
  list:    (params = {})   => api.get('/admin/arco-requests', { params }),
  resolve: (id, status, resolution) =>
    api.patch(`/admin/arco-requests/${id}/resolve`, { status, resolution }),
}

// ── RAG Agent API ─────────────────────────────────────────────────────────────
const RAG_BASE = import.meta.env.VITE_RAG_URL || 'http://localhost:8004'
const ragAxios = axios.create({ baseURL: RAG_BASE })

ragAxios.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const ragAPI = {
  chat: (body) =>
    ragAxios.post('/agent/chat', body).then(r => r.data),
  clearSession: (sessionId) =>
    ragAxios.delete(`/agent/session/${sessionId}`).then(r => r.data),
  indexStatus: () =>
    ragAxios.get('/agent/index/status').then(r => r.data),
  rebuildIndex: () =>
    ragAxios.post('/agent/index/rebuild').then(r => r.data),
  ragasReport: () =>
    ragAxios.get('/agent/ragas/report').then(r => r.data),
  ragasRun: () =>
    ragAxios.post('/agent/ragas/run').then(r => r.data),
  ragasStatus: () =>
    ragAxios.get('/agent/ragas/status').then(r => r.data),
}

// ── SuperUser API ─────────────────────────────────────────────────────────────
export const superuserAPI = {
  login: (body) =>
    api.post('/api/v1/auth/superuser/login', body).then(r => r.data),

  register: (body) =>
    api.post('/api/v1/auth/superuser/register', body).then(r => r.data),

  searchPatient: (token, identifier) =>
    axios.get(`${BASE}/api/v1/superuser/patients`, {
      params: { identifier },
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  createPatient: (token, fhirPatient) =>
    axios.post(`${BASE}/api/v1/superuser/patients`, fhirPatient, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  getObservations: (token, patientId, loincCode) =>
    axios.get(`${BASE}/api/v1/superuser/patients/${patientId}/observations`, {
      params: loincCode ? { loinc_code: loincCode } : {},
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  createObservation: (token, patientId, fhirObs) =>
    axios.post(`${BASE}/api/v1/superuser/patients/${patientId}/observations`, fhirObs, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  inference: (token, modelType, body) =>
    axios.post(`${BASE}/api/v1/superuser/inference/${modelType}`, body, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  softDelete: (token, patientId, reason, icd10Code) =>
    axios.delete(`${BASE}/api/v1/superuser/patients/${patientId}`, {
      data: { reason, icd10_code: icd10Code },
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  myPatients: (token) =>
    axios.get(`${BASE}/api/v1/superuser/my-patients`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),

  agentChat: (token, body) =>
    axios.post(`${BASE}/api/v1/superuser/agent/chat`, body, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.data),
}

export default api