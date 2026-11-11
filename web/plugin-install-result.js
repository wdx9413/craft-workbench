export function pluginInstallResult(plugin, success) {
  if (plugin.runtime_status === 'unsupported') return { message: '已登记插件，暂不支持启用：' + (plugin.unsupported_reason || '请查看详情'), warning: true };
  if (plugin.runtime_status === 'descriptor_only') return { message: '已登记插件信息，暂不可使用，请查看详情', warning: false };
  return { message: success, warning: false };
}
