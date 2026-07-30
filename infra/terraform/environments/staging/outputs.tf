output "module_name_prefixes" {
  description = "Naming prefixes exposed by the Phase 1 module interfaces."
  value = {
    network        = module.network.name_prefix
    compute        = module.compute.name_prefix
    database       = module.database.name_prefix
    cache          = module.cache.name_prefix
    object_storage = module.object_storage.name_prefix
    observability  = module.observability.name_prefix
    backup         = module.backup.name_prefix
  }
}
