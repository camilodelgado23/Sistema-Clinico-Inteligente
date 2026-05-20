import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
  token:  sessionStorage.getItem('token') || null,
  role:   (sessionStorage.getItem('role') || '').toUpperCase() || null,
  userId: sessionStorage.getItem('userId') || null,
  needsHabeas: false,
  pendingReports: 0,
  setPendingReports: (n) => set({ pendingReports: n }),

  setAuth: ({ access_token, role, user_id, needs_habeas_data }) => {
    const normalizedRole = role?.toUpperCase()

    sessionStorage.setItem('token', access_token)
    sessionStorage.setItem('role', normalizedRole)
    sessionStorage.setItem('userId', user_id)

    set({
      token: access_token,
      role: normalizedRole,
      userId: user_id,
      needsHabeas: needs_habeas_data
    })
  },

  clearAuth: () => {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('role')
    sessionStorage.removeItem('userId')

    set({
      token: null,
      role: null,
      userId: null,
      needsHabeas: false
    })
  },

  isAdmin:    () => get().role === 'ADMIN',
  isMedico:   () => ['MEDICO','ADMIN'].includes(get().role),
  isPaciente: () => get().role === 'PACIENTE',
}))