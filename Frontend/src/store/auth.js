import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
  token:  localStorage.getItem('token') || null,
  role:   (localStorage.getItem('role') || '').toUpperCase() || null,
  userId: localStorage.getItem('userId') || null,
  needsHabeas: false,

  setAuth: ({ access_token, role, user_id, needs_habeas_data }) => {
    const normalizedRole = role?.toUpperCase()

    localStorage.setItem('token', access_token)
    localStorage.setItem('role', normalizedRole)
    localStorage.setItem('userId', user_id)

    set({
      token: access_token,
      role: normalizedRole,
      userId: user_id,
      needsHabeas: needs_habeas_data
    })
  },

  clearAuth: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('userId')

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