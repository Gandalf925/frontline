export function hasEstablishedHomeBase(state) {
  return state?.world?.homeBase?.status === 'ESTABLISHED';
}
