import copy
import unittest
import image_identity as module


class ImageIdentity(unittest.TestCase):
    def setUp(self):
        self.manifest='sha256:'+'a'*64;self.config='sha256:'+'b'*64
        self.ref='ghcr.io/silviomasuccio6/fleetum-backend@'+self.manifest
        self.source='1'*40;self.tree='2'*40
        self.local={'id':self.manifest,'repoDigests':[self.ref],'source':self.source,'tree':self.tree,'os':'linux','arch':'amd64'}
        self.registry={'Descriptor':{'digest':self.manifest},'SchemaV2Manifest':{'config':{'digest':self.config}}}
    def check(self,runtime=None):
        return module.same_tested_backend(self.ref,self.config,self.source,self.tree,runtime or self.local['id'],self.local,self.registry)
    def test_manifest_store_identity_is_bridged_to_the_exact_tested_config(self):self.assertTrue(self.check())
    def test_classic_config_identity_is_accepted(self):
        self.local['id']=self.config;self.assertTrue(self.check())
    def test_different_config_is_rejected(self):
        self.registry['SchemaV2Manifest']['config']['digest']='sha256:'+'c'*64;self.assertFalse(self.check())
    def test_unknown_runtime_identity_is_rejected(self):self.assertFalse(self.check('sha256:'+'d'*64))
    def test_missing_immutable_reference_is_rejected(self):
        self.local['repoDigests']=[];self.assertFalse(self.check())
    def test_different_descriptor_is_rejected(self):
        self.registry['Descriptor']['digest']='sha256:'+'e'*64;self.assertFalse(self.check())
    def test_changed_source_tree_or_platform_are_rejected(self):
        for key,value in [('source','3'*40),('tree','4'*40),('os','darwin'),('arch','arm64')]:
            old=copy.deepcopy(self.local);self.local[key]=value;self.assertFalse(self.check());self.local=old
    def test_ambiguous_registry_manifest_is_rejected(self):
        self.registry=[self.registry];self.assertFalse(self.check())

if __name__=='__main__':unittest.main()
